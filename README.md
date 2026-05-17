# tray-linx-sync

Middleware de integração e-commerce desenvolvido para a **Parts Barão** (partsbarao.com.br). Sincroniza pedidos e estoque entre a plataforma **Tray Commerce** e o ERP **Linx AutoShop e-Commerce Premium**.

Deploy: **Railway** (`tray-linx-sync-production.up.railway.app`) · Banco: **Supabase** (`mcqpduxeqqioscmurhac`, sa-east-1)

---

## Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Runtime | Node.js 22 LTS (Alpine) | — |
| Linguagem | TypeScript 5 (strict) | — |
| Framework HTTP | Hono + @hono/node-server | 4.7 |
| Banco de dados | Supabase (PostgreSQL) | — |
| Fila de pedidos | Tabela `order_queue` + polling 30s | — |
| Scheduler | node-cron | 4.1 |
| HTTP client | axios | 1.10 |
| Validação | zod | 3.24 |
| Logs | pino (JSON prod, pretty dev) | 9.7 |
| Hospedagem | Railway | $5/mês |

---

## Fluxos

### Fluxo 1 — Sincronização de estoque (Linx → Tray) ✅ Funcionando

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
    │
    ├─ tray/products.ts · updateTrayStock(productId, newStock)
    │      PUT /web_api/products/:id
    │
    └─ Salva resultado em sync_logs (Supabase)
```

---

### Fluxo 2 — Pedidos (Tray → Linx) ✅ Funcionando em produção

A Tray envia eventos como **thin webhook** (`x-www-form-urlencoded`). O middleware responde `200 OK` imediatamente e processa de forma assíncrona.

```
POST /webhooks/tray/orders
    │  scope_name=order&scope_id=12345&act=insert&seller_id=...
    │  (formato: x-www-form-urlencoded — NÃO JSON)
    │
    ▼  responde 200 OK imediatamente
    │
    ▼
Supabase · tabela order_queue
    │  UPSERT ON CONFLICT (scope_id) — deduplicação automática
    │  status = "pending"
    │
    ▼
Worker (polling 30s, até 5 pedidos por ciclo)
    │
    ├─ tray/auth.ts · getTrayToken()
    │      Busca em tray_tokens (Supabase); renova se < 1h de validade
    │
    ├─ tray/orders.ts · getTrayOrderComplete(orderId)
    │      GET /web_api/orders/:id/complete?access_token=...
    │
    ├─ Filtro de status: apenas "FINALIZADO" e "A ENVIAR"
    │      Outros → marca skipped, não envia à Linx
    │
    └─ linx/orders.ts · sendOrderToLinx(orderData)
           │
           ├─ Passo 1: obter codigoCliente
           │      Tenta CadastrarClienteSimplificado (POST .../CadastrarClienteSimplificado)
           │      Se CPF já existe → buscarClienteLinx() (POST .../ConsultaClientes)
           │           payload mínimo: { CgcOuCpf, Empresa:1, Revenda:1, ... }
           │           extrai [0].Cliente do array retornado
           │
           ├─ Passo 2: abrir atendimento
           │      POST .../InserirContato
           │      Retorna contatoId (inteiro direto, não JSON)
           │
           └─ Passo 3: inserir itens (por produto)
                  buscarCodigoEstoque(reference) → POST .../ConsultaPecaGerencial
                  POST .../InserirItem?tipoVenda=V&editadoNaSelPecaPai=false
                  ValorUnitario vem do price real da Tray
```

**Resultado salvo em `linx_response`:**
```json
{
  "codigoCliente": 4020,
  "clienteNome": "Joao Ricardo Christoffoli",
  "clienteDocumento": "********104",
  "contatoId": 60835,
  "itensInseridos": 1,
  "itensFalhados": 0,
  "itens": [{ "reference": "1024965", "codigoEstoque": 45247, "quantidade": 1, "status": "inserido" }]
}
```

**Rastreabilidade por etapa em `processing_steps`:**
```json
[
  { "step": "tray_token",    "ok": true, "at": "..." },
  { "step": "tray_fetch",    "ok": true, "at": "...", "trayStatus": "FINALIZADO", "customerName": "..." },
  { "step": "status_filter", "ok": true, "at": "..." },
  { "step": "linx_send",     "ok": true, "at": "...", "contatoId": 60835, "codigoCliente": 4020 }
]
```

---

## Banco de dados (Supabase)

### `order_queue`

| Coluna | Tipo | Descrição |
|---|---|---|
| `scope_id` | TEXT UNIQUE | ID do pedido na Tray |
| `status` | TEXT | `pending` · `processing` · `done` · `failed` · `skipped` |
| `attempts` | INTEGER | Tentativas realizadas |
| `max_attempts` | INTEGER | Limite (padrão: 3) |
| `tray_order_data` | JSONB | Resposta completa de `/orders/:id/complete` |
| `linx_response` | JSONB | Dados retornados após envio à Linx |
| `processing_steps` | JSONB | Array com cada etapa do processamento + timestamp |
| `error_message` | TEXT | Último erro (limpo quando vai a `done`) |
| `processed_at` | TIMESTAMPTZ | Quando foi concluído |

### `tray_tokens`

| Coluna | Tipo | Descrição |
|---|---|---|
| `store_id` | TEXT UNIQUE | Identificador da loja (`partsbarao`) |
| `access_token` | TEXT | Token ativo |
| `expires_at` | TIMESTAMPTZ | Validade (~3 horas) |
| `api_host` | TEXT | Host da API Tray |

### `sync_logs`

| Coluna | Tipo | Descrição |
|---|---|---|
| `sync_type` | TEXT | `stock` |
| `status` | TEXT | `success` · `partial` · `error` |
| `total_items` | INTEGER | Total processados |
| `success_count` / `error_count` | INTEGER | Contadores |
| `duration_ms` | INTEGER | Duração total |
| `details` | JSONB | Resultado por produto |

---

## Variáveis de ambiente

```env
PORT=3000
NODE_ENV=production              # OBRIGATÓRIO no Railway para suprimir logs de localhost

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

TRAY_CONSUMER_KEY=
TRAY_CONSUMER_SECRET=
TRAY_AUTH_CODE=                  # Código permanente — reutilizado a cada renovação de token
TRAY_STORE_URL=https://www.partsbarao.com.br

LINX_API_URL=https://auto-gwsmartapi.linx.com.br
LINX_SUBSCRIPTION_KEY=
LINX_AMBIENTE=

ALERT_WEBHOOK_URL=               # Opcional — Slack/Discord/Make para alertas de falha
ADMIN_API_KEY=                   # Opcional — protege rotas /admin
```

---

## Rotas HTTP

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/health` | pública | Health check + status Supabase |
| `POST` | `/webhooks/tray/orders` | pública | Receptor Tray (thin webhook, form-urlencoded) |
| `GET` | `/admin/queue` | ADMIN_API_KEY | Status da fila por status |
| `POST` | `/admin/reprocess/:scopeId` | ADMIN_API_KEY | Reprocessa pedido específico |
| `POST` | `/admin/reprocess-failed` | ADMIN_API_KEY | Reprocessa todos os `failed` |
| `GET` | `/simulate-linx` | dev only | Consulta estoque Linx (bloqueado em produção) |

### Testar webhook manualmente

```bash
# Formato correto: x-www-form-urlencoded (igual ao que a Tray envia)
curl -X POST https://tray-linx-sync-production.up.railway.app/webhooks/tray/orders \
  -d "scope_id=12345&scope_name=order&act=insert&seller_id=1"
```

### Reprocessar pedido falhado

```bash
curl -X POST https://tray-linx-sync-production.up.railway.app/admin/reprocess/12345 \
  -H "Authorization: Bearer <ADMIN_API_KEY>"
```

---

## Comportamento do worker

| Parâmetro | Valor |
|---|---|
| Intervalo de polling | 30 segundos |
| Pedidos por ciclo | 5 |
| Tentativas máximas | 3 |
| Após 3 falhas | `failed` + alerta via `ALERT_WEBHOOK_URL` |
| Lock de concorrência | flag `isProcessing` |
| Recuperação de travados | `recover-stuck.ts` a cada 5min |

---

## Token Tray — comportamento confirmado

- Validade: **~3 horas**
- `TRAY_AUTH_CODE` é **permanente** — reutilizado a cada renovação
- Renovação: `POST /web_api/auth` com `consumer_key + consumer_secret + code` **apenas** (nunca incluir `refresh_token` — retorna token expirado)
- Token com > 1h de validade → reutilizado do Supabase
- Token com < 1h → renova e salva no banco

---

## Linx AutoShop — endpoints utilizados

| Endpoint | Uso |
|---|---|
| `POST /ConsultaPecaGerencial` | Buscar estoque e `CodigoEstoque` por referência |
| `POST /Geral/ManutencaoClienteSimplificado/CadastrarClienteSimplificado` | Cadastrar cliente novo |
| `POST /Geral/ConsultaClientes/ConsultaClientes` | Buscar cliente existente por CPF (`CgcOuCpf`) |
| `POST /Pecas/AtendimentoBalcao/Atendimento/InserirContato` | Abrir atendimento (retorna inteiro direto) |
| `POST /Pecas/AtendimentoBalcao/Atendimento/InserirItem` | Inserir item (requer `?tipoVenda=V&editadoNaSelPecaPai=false`) |

**Headers obrigatórios em todas as chamadas:**
```
Content-Type: application/json-patch+json
Cache-Control: no-cache
Ocp-Apim-Subscription-Key: {LINX_SUBSCRIPTION_KEY}
Ambiente: {LINX_AMBIENTE}
Authorization: (vazio)
```

---

## Scripts

```bash
npm run dev                      # Hot reload com tsx
npm run build                    # Compila TypeScript → dist/
npm start                        # Produção: node dist/index.js
node scripts/test-stock-sync.mjs # Teste manual: sync 2 produtos Linx → Tray
```

---

## Deploy (Railway)

1. Conectar repositório GitHub no Railway
2. Adicionar todas as variáveis de ambiente (incluindo `NODE_ENV=production`)
3. Railway detecta o `Dockerfile` e faz o build automaticamente
4. Cada `git push origin main` dispara novo deploy

Dockerfile: multi-stage — builder (npm ci + tsc) → produção (dist/ + node_modules, Node 22 Alpine).

---

## Cliente

**Parts Barão** — autopeças  
Loja: [partsbarao.com.br](https://www.partsbarao.com.br)  
ERP: Linx AutoShop (`auto-gwsmartapi.linx.com.br`)  
Webhook registrado: `POST https://tray-linx-sync-production.up.railway.app/webhooks/tray/orders`
