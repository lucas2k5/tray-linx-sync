# tray-linx-sync

Middleware de integração e-commerce desenvolvido para a **Parts Barão** (partsbarao.com.br). Sincroniza pedidos e estoque entre a plataforma **Tray Commerce** e o ERP **Linx AutoShop e-Commerce Premium**.

**v2.0** — reescrito em TypeScript com Hono, Supabase e deploy no Railway.

---

## Stack

| Camada | Tecnologia | Por quê |
|---|---|---|
| Runtime | Node.js 22 LTS | Estável, suporte LTS longo |
| Linguagem | TypeScript 5 (strict) | Tipagem, segurança, manutenibilidade |
| Framework HTTP | Hono | 14 KB, TypeScript-first, 78k req/s |
| Banco de dados | Supabase (PostgreSQL) | Gerenciado, backup automático, sem infra |
| Fila de pedidos | Tabela `order_queue` (polling 30s) | Sem Redis, sem BullMQ, sem infra extra |
| Cron | node-cron (dentro do processo) | Railway é always-on, funciona sem cron externo |
| HTTP client | axios | Já validado com as APIs Tray e Linx |
| Validação | zod | Env vars e payloads de webhook |
| Logs | pino | JSON estruturado em produção, colorido em dev |
| Hospedagem | Railway | $5/mês, deploy via git push, always-on |

---

## Fluxos

O app roda dois fluxos independentes no mesmo processo.

### Fluxo 1 — Sincronização de estoque (Linx → Tray) ✅ Testado

```
Cron 01:00 BRT
    │
    ▼
linx/stock.ts · fetchStockFromLinx()
    │  POST /api-e-commerce-premium/ConsultaPecaGerencial
    │  Retorna produtos com ItemEstoque + QuantidadeDisponivel
    │
    ▼
jobs/sync-stock.ts (lotes de 10 produtos)
    │
    ├─ tray/products.ts · getTrayProductByReference(reference)
    │      GET /web_api/products/?reference=...
    │      O campo ItemEstoque da Linx é o reference do produto na Tray
    │
    ├─ tray/products.ts · updateTrayStock(productId, newStock)
    │      PUT /web_api/products/:id
    │
    └─ Salva resultado em sync_logs (Supabase)
```

Testado com dados reais: produto `2P0721257` (ID 115 na Tray) atualizado com sucesso via `scripts/test-stock-sync.mjs`.

---

### Fluxo 2 — Recebimento de pedidos (Tray → Linx)

A Tray opera como **thin webhook**: envia apenas o `scope_id` e espera `200 OK` em milissegundos. Todo o processamento pesado é assíncrono.

```
POST /webhooks/tray/orders
    │  { scope_name: "order", scope_id: "12345" }
    │
    ▼  responde 200 OK imediatamente
    │
    ▼
Supabase · tabela order_queue
    │  UPSERT com ON CONFLICT (scope_id) — deduplicação automática
    │  status = "pending"
    │
    ▼
Worker (polling a cada 30s, até 5 pedidos por ciclo)
    │
    ├─ tray/auth.ts · getTrayToken()
    │      Busca em tray_tokens (Supabase) ou renova via /web_api/auth
    │
    ├─ tray/orders.ts · getTrayOrderComplete(orderId)
    │      GET /web_api/orders/:id/complete
    │      Retorna: Order, Customer, CustomerAddresses,
    │               ProductsSold, Payment, OrderInvoice
    │
    ├─ Verifica Order.status === "FINALIZADO"
    │      Outros status (aguardando pagamento, cancelado…) → marca skipped, ignora
    │
    └─ linx/orders.ts · sendOrderToLinx(orderData)
           1. buscarClienteLinx(cpf/cnpj)
                POST /Geral/ConsultaClientes/ConsultaClientesPaginado
                Se não encontrado → cadastrarClienteSimplificado()
                POST /Geral/ManutencaoClienteSimplificado/CadastrarClienteSimplificado
           2. inserirContato(codigoCliente, orderId)
                POST /Pecas/AtendimentoBalcao/Atendimento/InserirContato
                Retorna contatoId (número do atendimento)
           3. inserirItem(contatoId, item) × N produtos
                POST /Pecas/AtendimentoBalcao/Atendimento/InserirItem
```

**Retry automático:** falha → `status = pending` → reprocessado no próximo ciclo. Após 3 tentativas → `status = failed`.

**Deduplicação:** múltiplos webhooks do mesmo pedido (comuns na Tray) são colapsados pelo `UPSERT ON CONFLICT (scope_id)`.

**Filtro de status:** apenas pedidos com `Order.status = "FINALIZADO"` são enviados à Linx. Os demais ficam com `status = skipped` na fila.

---

## Estrutura do projeto

```
tray-linx-sync/
├── src/
│   ├── index.ts                    ← Entry point: Hono + cron jobs
│   ├── lib/
│   │   ├── env.ts                  ← Validação de env vars com zod (falha no startup se faltante)
│   │   ├── supabase.ts             ← Cliente Supabase singleton
│   │   ├── logger.ts               ← Pino: JSON em produção, colorido em dev
│   │   └── alerts.ts               ← Webhook de alerta quando pedido vai a failed
│   ├── types/
│   │   ├── tray.ts                 ← Interfaces da API Tray
│   │   └── linx.ts                 ← Interfaces da API Linx
│   ├── routes/
│   │   ├── webhook.ts              ← POST /webhooks/tray/orders (thin webhook)
│   │   ├── health.ts               ← GET /health (verifica conexão Supabase)
│   │   ├── admin.ts                ← Rotas /admin protegidas por API key
│   │   └── debug.ts                ← GET /simulate-linx, /simulate-tray-order (bloqueado em production)
│   ├── workers/
│   │   ├── process-order.ts        ← Polling + processamento da fila (30s)
│   │   └── recover-stuck.ts        ← Recupera pedidos travados em "processing" (5min)
│   ├── jobs/
│   │   └── sync-stock.ts           ← Cron de sincronização de estoque
│   └── services/
│       ├── tray/
│       │   ├── auth.ts             ← Token management via Supabase (renova com code)
│       │   ├── orders.ts           ← getTrayOrderComplete()
│       │   └── products.ts         ← Busca e atualização de produtos
│       └── linx/
│           ├── stock.ts            ← Consulta de estoque
│           └── orders.ts           ← Envio de pedido (3 passos)
├── scripts/
│   └── test-stock-sync.mjs         ← Teste manual de sync de estoque (2 produtos)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  ← Schema completo do banco
├── tsconfig.json
├── Dockerfile                      ← Multi-stage build para Railway
├── .env.example
└── package.json
```

---

## Banco de dados (Supabase)

Projeto: `mcqpduxeqqioscmurhac` (região: sa-east-1, São Paulo)

### Tabelas

**`order_queue`** — fila de pedidos recebidos via webhook

| Coluna | Tipo | Descrição |
|---|---|---|
| `scope_id` | TEXT UNIQUE | ID do pedido na Tray (chave de deduplicação) |
| `status` | TEXT | `pending` · `processing` · `done` · `failed` · `skipped` |
| `attempts` | INTEGER | Número de tentativas realizadas |
| `max_attempts` | INTEGER | Limite de tentativas (padrão: 3) |
| `tray_order_data` | JSONB | Resposta completa de `/orders/:id/complete` |
| `linx_response` | JSONB | Resposta da Linx após envio |
| `error_message` | TEXT | Última mensagem de erro |
| `processed_at` | TIMESTAMPTZ | Timestamp de conclusão |

**`tray_tokens`** — tokens de autenticação Tray (substitui `tray-token.json` em disco)

| Coluna | Tipo | Descrição |
|---|---|---|
| `store_id` | TEXT UNIQUE | Identificador da loja (`partsbarao`) |
| `access_token` | TEXT | Token ativo |
| `refresh_token` | TEXT | Refresh token (armazenado, não usado no fluxo de renovação) |
| `expires_at` | TIMESTAMPTZ | Data de expiração (tokens duram ~3 horas) |
| `api_host` | TEXT | Host da API Tray |

**`sync_logs`** — histórico de sincronizações de estoque

| Coluna | Tipo | Descrição |
|---|---|---|
| `sync_type` | TEXT | Tipo de sync (ex: `stock`) |
| `status` | TEXT | `success` · `partial` · `error` |
| `total_items` | INTEGER | Total de produtos processados |
| `success_count` | INTEGER | Atualizados com sucesso |
| `error_count` | INTEGER | Com falha |
| `duration_ms` | INTEGER | Duração em milissegundos |
| `details` | JSONB | Resultado por produto |

---

## Pré-requisitos

- **Node.js** 22+
- Conta no **[Supabase](https://supabase.com)** (plano free é suficiente)
- Credenciais da **API Tray Commerce** (consumer key, secret, auth code)
- Credenciais da **API Linx AutoShop** (subscription key, identificador de ambiente)

---

## Instalação

```bash
# 1. Clonar
git clone https://github.com/lucas2k5/tray-linx-sync.git
cd tray-linx-sync

# 2. Instalar dependências
npm install

# 3. Criar banco no Supabase
# Acesse o SQL Editor do seu projeto Supabase e execute:
# supabase/migrations/001_initial_schema.sql

# 4. Configurar variáveis de ambiente
cp .env.example .env
# Preencher .env com as credenciais reais
```

---

## Variáveis de ambiente

O app usa **zod** para validar todas as vars no startup. Se qualquer variável obrigatória estiver faltando, o processo encerra imediatamente com a lista do que está faltando.

```env
# ── Servidor ───────────────────────────────────────────────
PORT=3000
NODE_ENV=development          # "development" | "production" | "test"

# ── Supabase ───────────────────────────────────────────────
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=    # Painel Supabase → Settings → API → service_role

# ── Tray Commerce ──────────────────────────────────────────
TRAY_CONSUMER_KEY=
TRAY_CONSUMER_SECRET=
TRAY_AUTH_CODE=               # Código de autorização permanente da loja
TRAY_STORE_URL=https://www.partsbarao.com.br

# ── Linx AutoShop ──────────────────────────────────────────
LINX_API_URL=https://auto-gwsmartapi.linx.com.br
LINX_SUBSCRIPTION_KEY=        # Ocp-Apim-Subscription-Key (portal Azure)
LINX_AMBIENTE=                # Ex: 02431719000102-BARAO-PRODUCAO

# ── Alertas (opcional) ─────────────────────────────────────
ALERT_WEBHOOK_URL=            # Webhook Slack/Discord/Make para alertas de falha

# ── Admin (opcional) ───────────────────────────────────────
ADMIN_API_KEY=                # Chave para proteger rotas /admin
```

> `.env` está no `.gitignore` e nunca deve ser commitado.

---

## Rodando localmente

```bash
npm run dev
```

Saída esperada:

```
[INFO] Servidor iniciado {"port": 3000}
[INFO] Webhook: POST http://localhost:3000/webhooks/tray/orders
[INFO] Health:  GET  http://localhost:3000/health
[INFO] Admin:   POST http://localhost:3000/admin/reprocess/:scopeId
```

### Testar webhook manualmente

```bash
curl -X POST http://localhost:3000/webhooks/tray/orders \
  -H "Content-Type: application/json" \
  -d '{"scope_name":"order","scope_id":"12345"}'
```

Resposta imediata:

```json
{ "ok": true }
```

O pedido entra na tabela `order_queue` com `status = pending` e é processado no próximo ciclo do worker (até 30s).

### Verificar saúde da aplicação

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "timestamp": "2026-05-15T...", "db": "up" }
```

### Testar sync de estoque (2 produtos)

```bash
node scripts/test-stock-sync.mjs
```

Busca 2 produtos da Linx e atualiza o estoque na Tray. Útil para validar as credenciais e o mapeamento de referências.

### Consultar estoque da Linx (apenas em development)

```bash
curl http://localhost:3000/simulate-linx
```

---

## Build e produção

```bash
npm run build   # compila TypeScript → dist/
npm start       # node dist/index.js
```

---

## Deploy no Railway

1. Criar projeto no [Railway](https://railway.app) e conectar o repositório GitHub
2. Adicionar as variáveis de ambiente no painel do Railway (mesmo conteúdo do `.env`)
3. Definir `NODE_ENV=production`
4. O Railway detecta o `Dockerfile` automaticamente e faz o build

O `Dockerfile` usa **multi-stage build**:
- Stage `builder`: instala todas as deps e compila TypeScript
- Stage final: apenas `dist/` + `node_modules` de produção (imagem enxuta)

---

## Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check — verifica conexão com Supabase |
| `POST` | `/webhooks/tray/orders` | Receptor de eventos da Tray (thin webhook) |
| `GET` | `/simulate-linx` | Consulta estoque Linx (bloqueado em `production`) |
| `GET` | `/simulate-tray-order` | Busca pedido mais recente completo da Tray (bloqueado em `production`) |
| `GET` | `/admin/queue` | Status da fila de pedidos (requer `ADMIN_API_KEY`) |
| `POST` | `/admin/reprocess/:scopeId` | Reprocessa pedido específico (requer `ADMIN_API_KEY`) |
| `POST` | `/admin/reprocess-failed` | Reprocessa todos os pedidos com falha (requer `ADMIN_API_KEY`) |

### Payload do webhook Tray

```json
{
  "scope_name": "order",
  "scope_id": "12345"
}
```

Aceita `scope_name`/`scope_id` em snake_case ou camelCase. Eventos com `scope_name` diferente de `"order"` são ignorados silenciosamente.

### Rotas de admin

```bash
# Ver status da fila
curl http://localhost:3000/admin/queue \
  -H "Authorization: Bearer <ADMIN_API_KEY>"

# Reprocessar pedido específico
curl -X POST http://localhost:3000/admin/reprocess/12345 \
  -H "Authorization: Bearer <ADMIN_API_KEY>"

# Reprocessar todos os falhados
curl -X POST http://localhost:3000/admin/reprocess-failed \
  -H "Authorization: Bearer <ADMIN_API_KEY>"
```

---

## Comportamento do worker

| Parâmetro | Valor | Detalhe |
|---|---|---|
| Intervalo de polling | 30 segundos | cron `*/30 * * * * *` |
| Pedidos por ciclo | 5 | Limita concorrência sem travar o processo |
| Tentativas máximas | 3 | Configurável por job via `max_attempts` |
| Falha → `pending` | Sim | Reprocessado no próximo ciclo |
| Após 3 falhas | `failed` | Não reprocessado; requer intervenção via `/admin` |
| Lock de concorrência | `isProcessing` flag | Impede sobreposição de ciclos |
| Recuperação de travados | 5 minutos | `recover-stuck.ts` resgata jobs em `processing` há mais de 5min |

---

## Gestão de token Tray

O token é obtido via `POST /web_api/auth` e persistido na tabela `tray_tokens` do Supabase.

**Comportamento confirmado em testes:**

- Tokens Tray têm validade de **~3 horas**
- O `TRAY_AUTH_CODE` é um código **permanente** da loja — pode ser reutilizado a cada renovação
- O fluxo correto de renovação é `consumer_key + consumer_secret + code` (nunca incluir `refresh_token` — a API retorna o token expirado nesse caso)
- Token com **mais de 1h de validade** → reutilizado do Supabase sem chamada extra
- Token com menos de 1h → renova automaticamente e salva no banco

---

## Estrutura real da resposta Tray `/orders/:id/complete`

A API retorna tudo aninhado dentro de `Order`. Não há `Customer` ou `ProductsSold` no topo:

```json
{
  "Order": {
    "id": "2627",
    "status": "FINALIZADO",
    "Customer": {
      "cpf": "32362806898",
      "name": "...",
      "email": "...",
      "zip_code": "13140-320",
      "address": "Avenida José Paulino",
      "neighborhood": "Santa Cecília",
      "city": "Paulínia",
      "state": "SP"
    },
    "ProductsSold": [
      {
        "ProductsSold": {
          "reference": "JGM4526S",
          "quantity": "2",
          "price": "195.00"
        }
      }
    ]
  }
}
```

Os campos de endereço do cliente vêm **diretamente no objeto `Customer`** (não em `CustomerAddresses` separado).

---

## Mapeamento de campos

| Campo Linx | Campo Tray | Status |
|---|---|---|
| `ItemEstoque` | `Order.ProductsSold[].ProductsSold.reference` | ✅ Confirmado em teste real |
| `QuantidadeDisponivel` | `Order.ProductsSold[].ProductsSold.quantity` | ✅ Confirmado em teste real |
| `CPFCNPJ` do cliente | `Order.Customer.cpf` / `.cnpj` | ✅ Confirmado (pedido 2627) |
| `Nome` | `Order.Customer.name` | ✅ |
| `EmailCasa` | `Order.Customer.email` | ✅ |
| `CEP` | `Order.Customer.zip_code` | ✅ |
| `Endereco` | `Order.Customer.address` | ✅ |
| `Bairro` | `Order.Customer.neighborhood` | ✅ |
| `Cidade` | `Order.Customer.city` | ✅ |
| `UF` | `Order.Customer.state` | ✅ |

---

## Pendências

### Bloqueadoras para fluxo de pedidos

- [ ] **Cadastrar webhook no painel Tray** — registrar `POST https://tray-linx-sync-production.up.railway.app/webhooks/tray/orders` como receptor do evento `order`
- [ ] **Validar resposta do `InserirContato`** — confirmar o nome do campo que retorna o ID do atendimento (`Contato`, `NumeroContato` ou `Id`) com um teste real contra a Linx
- [ ] **Validar resposta do `CadastrarClienteSimplificado`** — confirmar campo do código de cliente retornado (`Cliente`, `CodigoCliente` ou `Codigo`)

### Melhorias futuras

- [ ] Validação de assinatura do webhook via `WEBHOOK_SECRET`
- [ ] Configurar `ALERT_WEBHOOK_URL` para notificações de pedidos falhados (Slack/Discord/Make)
- [ ] Configurar `ADMIN_API_KEY` em produção para proteger as rotas `/admin`

---

## Dependências principais

| Pacote | Versão | Uso |
|---|---|---|
| `hono` | ^4.7 | Framework HTTP |
| `@hono/node-server` | ^1.13 | Adapter Node.js para o Hono |
| `@supabase/supabase-js` | ^2.49 | Cliente Supabase (banco + auth) |
| `node-cron` | ^4.1 | Agendamento de cron jobs |
| `axios` | ^1.10 | Chamadas HTTP para Tray e Linx |
| `zod` | ^3.24 | Validação de env vars e payloads |
| `pino` | ^9.7 | Logs estruturados JSON |
| `dotenv` | ^16.5 | Carregamento de variáveis de ambiente |
| `tsx` | ^4.19 | Execução TypeScript em desenvolvimento |
| `typescript` | ^5.8 | Compilador |

---

## Cliente

**Parts Barão** — autopeças  
Loja: [partsbarao.com.br](https://www.partsbarao.com.br)  
ERP: Linx AutoShop (`auto-gwsmartapi.linx.com.br`)
