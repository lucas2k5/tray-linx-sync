# tray-linx-sync

Sincronizador Node.js entre a plataforma **Tray Commerce** e o ERP **Linx AutoShop e-Commerce Premium**, desenvolvido para a **Parts Barão** (partsbarao.com.br).

---

## Visão geral

O sistema possui dois fluxos independentes que rodam no mesmo processo:

| Fluxo | Direção | Trigger |
|---|---|---|
| Sincronização de estoque | Linx → Tray | Cron diário às 01:00 (Brasília) |
| Recebimento de pedidos | Tray → Linx | Webhook em tempo real |

---

## Arquitetura

### Fluxo 1 — Sincronização de estoque (Linx → Tray)

```
Cron 01:00 BRT
    │
    ▼
linxService.fetchStockFromLinx()
    │  POST /api-e-commerce-premium/ConsultaPecaGerencial
    │  Retorna lista de produtos com ItemEstoque e QuantidadeDisponivel
    │
    ▼
syncStock.js (lotes de 10 produtos)
    │
    ├─ trayService.getTrayProductByReference(reference)
    │      GET /web_api/products/?reference=...
    │
    └─ trayService.updateTrayStock(productId, newStock)
           PUT /web_api/products/:id
```

O campo `ItemEstoque` da Linx é usado como `reference` na Tray para localizar o produto. O estoque é atualizado produto a produto em lotes de 10 para evitar sobrecarga na API da Tray.

---

### Fluxo 2 — Recebimento de pedidos (Tray → Linx)

A Tray opera como **thin webhook**: envia apenas o `scope_id` (ID do pedido) e espera uma resposta `200 OK` em milissegundos. Todo o processamento pesado acontece de forma assíncrona via fila.

```
Tray Webhook POST /webhooks/tray/v1/orders
    │  { scope_name: "order", scope_id: "12345" }
    │
    ▼ responde 200 OK imediatamente
    │
    ▼
BullMQ Queue "tray-orders"
    │  jobId = scope_id (deduplicação automática)
    │  delay = 8s (absorve atualizações rápidas consecutivas do mesmo pedido)
    │
    ▼
Worker (concorrência: 3, retry: 3× exponencial a partir de 5s)
    │
    ├─ trayService.getTrayToken()
    │      Busca token em tray-token.json ou renova via /web_api/auth
    │
    ├─ trayService.getTrayOrderComplete(orderId)
    │      GET /web_api/orders/:id/complete
    │      Retorna em uma única chamada:
    │        Order, Customer, CustomerAddresses,
    │        ProductsSold, Payment, OrderInvoice
    │
    └─ linxOrderService.sendOrderToLinx(orderData)
           1. buscarClienteLinx(cpf/cnpj)
           2. inserirContato() → obtém Contato ID
           3. inserirItem() × N produtos
```

**Por que o delay de 8 segundos?**
Um único pedido na Tray pode gerar 5 a 10 webhooks em frações de segundo (criação, aprovação de pagamento, separação etc.). Como o BullMQ usa `jobId` único por pedido, notificações repetidas do mesmo `scope_id` que chegarem dentro do delay são descartadas automaticamente. O worker processa apenas o estado final.

---

## Estrutura de arquivos

```
tray-linx-sync/
├── config/
│   └── redis.js              # Conexão Redis para o BullMQ
├── jobs/
│   ├── syncStock.js          # Job de sincronização de estoque (cron)
│   └── orderQueue.js         # Fila BullMQ + worker de pedidos
├── services/
│   ├── linxService.js        # Consulta de estoque na Linx AutoShop
│   ├── linxOrderService.js   # Transformação e envio de pedidos à Linx
│   └── trayService.js        # Auth, produtos e pedidos da Tray
├── utils/
│   └── logger.js             # Utilitário de log simples
├── .env.example              # Template de variáveis de ambiente
├── .gitignore
├── Dockerfile
├── index.js                  # Entrypoint: Express + cron + worker
└── package.json
```

---

## Pré-requisitos

- **Node.js** 18+
- **Redis** 6+ (usado pelo BullMQ para a fila de pedidos)
- Credenciais de acesso à **API Tray Commerce** (consumer key, secret e auth code)
- Credenciais de acesso à **API Linx AutoShop** (subscription key e identificador de ambiente)

---

## Instalação

```bash
# 1. Clonar o repositório
git clone https://github.com/lucas2k5/tray-linx-sync.git
cd tray-linx-sync

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com as credenciais reais
```

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha todos os campos:

```env
# ── Tray Commerce ──────────────────────────────────────────
TRAY_CONSUMER_KEY=        # Consumer Key gerada no painel Tray
TRAY_CONSUMER_SECRET=     # Consumer Secret gerada no painel Tray
TRAY_AUTH_CODE=           # Código de autorização da loja
TRAY_STORE_URL=https://www.partsbarao.com.br

# ── Linx AutoShop ──────────────────────────────────────────
LINX_API_URL=https://auto-gwsmartapi.linx.com.br
LINX_SUBSCRIPTION_KEY=    # Chave de assinatura do portal Azure (Ocp-Apim-Subscription-Key)
LINX_AMBIENTE=            # Identificador de ambiente (ex: 02431719000102-BARAO-PRODUCAO)

# ── Redis (BullMQ) ─────────────────────────────────────────
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=           # Deixar vazio se o Redis não usar senha

# ── Servidor Express ───────────────────────────────────────
PORT=3000
BASE_URL=http://localhost:3000
```

> **Segurança:** o arquivo `.env` e o `tray-token.json` (token persistido em disco) estão no `.gitignore` e nunca devem ser commitados.

---

## Executando localmente

### 1. Subir o Redis

**Via Homebrew (macOS):**
```bash
brew install redis
brew services start redis
```

**Via Docker:**
```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

### 2. Rodar o servidor

```bash
node index.js
```

Saída esperada na inicialização:
```
🚀 Servidor rodando em http://localhost:3000
🔗 Webhook Tray: http://localhost:3000/webhooks/tray/v1/orders
```

### 3. Testar o webhook manualmente

```bash
curl -X POST http://localhost:3000/webhooks/tray/v1/orders \
  -H "Content-Type: application/json" \
  -d '{"scope_name":"order","scope_id":"12345"}'
```

Resposta imediata:
```json
{ "ok": true }
```

Após ~8 segundos, o worker processa o pedido e loga os dados completos no console.

### 4. Testar a consulta de estoque Linx

```bash
curl http://localhost:3000/simulate-linx
```

Retorna a lista de produtos com estoque válido da Linx AutoShop.

---

## Executando via Docker

```bash
# Build da imagem
docker build -t tray-linx-sync .

# Rodar (ajustar REDIS_HOST para o host onde o Redis está rodando)
docker run -d \
  --env-file .env \
  -e REDIS_HOST=host.docker.internal \
  -p 3000:3000 \
  tray-linx-sync
```

> Em produção com Docker Compose, adicione um serviço Redis e use o nome do serviço como `REDIS_HOST`.

---

## Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Health check — retorna `"API de sincronização ativa"` |
| `GET` | `/simulate-linx` | Consulta e retorna o estoque atual da Linx |
| `POST` | `/webhooks/tray/v1/orders` | Endpoint receptor de webhooks da Tray |

### Payload esperado no webhook

```json
{
  "scope_name": "order",
  "scope_id": "12345"
}
```

O endpoint aceita `scope_name` e `scope_id` tanto em `snake_case` quanto em `camelCase`. Eventos com `scope_name` diferente de `"order"` são ignorados silenciosamente.

---

## Gestão do token Tray

O token é obtido via `POST /web_api/auth` e salvo localmente em `tray-token.json`. A cada requisição, o sistema verifica a validade:

- Se o token tem **mais de 24 horas** de validade restante → reutiliza
- Se está próximo de expirar → solicita um novo automaticamente

Isso evita chamadas desnecessárias de autenticação a cada operação.

---

## Fila de pedidos — comportamento detalhado

| Parâmetro | Valor | Motivo |
|---|---|---|
| Nome da fila | `tray-orders` | — |
| `jobId` | `scope_id` do pedido | Deduplicação: mesmo ID descarta notificações duplicadas |
| `delay` | 8 segundos | Garante que o estado final do pedido chegue antes de processar |
| `attempts` | 3 | Tolerância a falhas temporárias nas APIs |
| `backoff` | Exponencial, 5s inicial | 5s → 25s → 125s entre tentativas |
| `concurrency` | 3 | Até 3 pedidos processados em paralelo |
| `removeOnComplete` | 100 jobs | Mantém histórico dos últimos 100 jobs bem-sucedidos |
| `removeOnFail` | 500 jobs | Mantém histórico dos últimos 500 jobs com falha |

---

## Mapeamento de campos Tray → Linx

O objeto retornado por `/orders/:id/complete` contém:

```
trayOrder
├── Order             → dados gerais (id, status, date, total, freight_value)
├── Customer          → cadastro (name, email, cpf, cnpj, phone)
├── CustomerAddresses → endereços de entrega e cobrança
├── ProductsSold      → itens (reference, name, price, quantity)
├── Payment           → transações de pagamento
└── OrderInvoice      → dados de nota fiscal
```

O fluxo de envio à Linx implementado em `services/linxOrderService.js` segue 3 passos em sequência:

| Passo | Endpoint Linx | Dados usados |
|---|---|---|
| 1. Buscar cliente | `POST /Geral/ConsultaClientes/ConsultaClientesPaginado` | `Customer.cpf` / `Customer.cnpj` |
| 2. Criar atendimento | `POST /Pecas/AtendimentoBalcao/Atendimento/InserirContato` | Retorna `Contato` ID |
| 3. Inserir itens (1×por produto) | `POST /Pecas/AtendimentoBalcao/Atendimento/InserirItem` | `ProductsSold[].reference`, `price`, `quantity` |

---

## Pendências

### Bloqueadoras (necessárias para o primeiro teste real)

- [ ] **Body correto do `InserirContato`** — a collection Postman disponível tem o body errado nesse endpoint (cópia do `ConsultaPecaGerencial`). É necessário obter junto à Linx a estrutura correta do payload para criação do atendimento. O restante do fluxo já está implementado ao redor desse ponto.

- [ ] **Validar mapeamento `reference` Tray → `ItemEstoque` Linx** — o campo `reference` dos produtos na Tray pode corresponder ao código público da Linx (ex: `"0290.01234"`) ou precisar de uma busca extra via `ConsultaPecaGerencial` para obter o `ItemEstoque` numérico interno. Confirmar no primeiro pedido real.

- [ ] **Redis rodando no ambiente de deploy** — o servidor não inicializa sem conexão Redis ativa. Subir instância Redis e configurar `REDIS_HOST`/`REDIS_PORT` no `.env`.

- [ ] **URL pública para receber webhooks da Tray** — a Tray precisa de HTTPS acessível externamente. Em desenvolvimento usar `ngrok http 3000`. Em produção garantir que `BASE_URL` aponta para o servidor público.

- [ ] **Cadastrar o webhook no painel da Tray** — após ter a URL pública, registrar `POST /webhooks/tray/v1/orders` como receptor do evento `order` no painel Tray Commerce.

### Melhorias futuras (não bloqueadoras)

- [ ] **Docker Compose** com serviço Redis para simplificar o deploy em produção
- [ ] **Monitoramento da fila** — BullMQ Board ou similar para visualizar jobs pendentes, falhos e concluídos
- [ ] **Alertas de falha** — notificação (e-mail ou Slack) quando um pedido falhar as 3 tentativas de retry

---

## Dependências principais

| Pacote | Versão | Uso |
|---|---|---|
| `express` | ^5.1.0 | Servidor HTTP e roteamento |
| `node-cron` | ^4.1.0 | Agendamento do cron de estoque |
| `bullmq` | ^5.76.8 | Fila de processamento assíncrono de pedidos |
| `ioredis` | ^5.10.1 | Cliente Redis para o BullMQ |
| `axios` | ^1.10.0 | Chamadas HTTP para Tray e Linx |
| `dotenv` | ^16.5.0 | Carregamento de variáveis de ambiente |

---

## Cliente

**Parts Barão** — autopeças  
Loja: [partsbarao.com.br](https://www.partsbarao.com.br)  
ERP: Linx AutoShop (`auto-gwsmartapi.linx.com.br`)
