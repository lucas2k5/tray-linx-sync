# CLAUDE.md — tray-linx-sync

## Agentes disponíveis — USE SEMPRE, não trabalhe sozinho

- `backend-tech-lead` → servidor Hono, rotas, workers, cron jobs, serviços de integração, Supabase, Railway
- `integration-specialist` → mapeamento de campos Tray ↔ Linx, payloads de API, fluxos de dados entre sistemas, tratamento de erros de API, validação de endpoints
- `data-engineer` → schema Supabase (PostgreSQL), migrations, queries de performance, análise de order_queue/sync_logs, índices
- `code-reviewer` → revisar TUDO antes de finalizar

## Fluxo obrigatório para qualquer feature

1. Planeje quais agentes envolver
2. Delegue para os agentes corretos (em paralelo se possível)
3. USE o `code-reviewer` em tudo ao final
4. Reporte resultado e pontos de atenção

---

## Sobre o projeto

Middleware de integração e-commerce para a **Parts Barão** (autopeças, `partsbarao.com.br`). Conecta a loja virtual **Tray Commerce** ao ERP **Linx AutoShop e-Commerce Premium**. Deploy no **Railway** ($5/mês), banco no **Supabase Pro** ($25/mês).

**Não tem frontend.** É um serviço backend puro — API HTTP + workers + cron jobs.

---

## Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Runtime | Node.js | 22 LTS (Alpine no Docker) |
| Linguagem | TypeScript | 5.8 (strict) |
| Framework HTTP | Hono + @hono/node-server | 4.7 |
| Banco de dados | Supabase (PostgreSQL) | — |
| Fila de pedidos | Tabela `order_queue` + polling 30s | — |
| Scheduler | node-cron | 4.1 |
| HTTP client | axios | 1.10 |
| Validação | zod | 3.24 |
| Logging | pino (JSON prod) + pino-pretty (dev) | 9.7 |
| Dev runner | tsx (watch mode) | 4.19 |

---

## Estrutura do projeto (estado atual)

```
tray-linx-sync/
├── src/
│   ├── index.ts                         ← Entry point: Hono app + 3 cron jobs
│   ├── lib/
│   │   ├── env.ts                       ← Validação env vars com zod (mata o processo se faltar)
│   │   ├── supabase.ts                  ← Cliente Supabase singleton
│   │   ├── logger.ts                    ← Pino: JSON em prod, pretty em dev
│   │   └── alerts.ts                    ← Webhook de alertas (Slack/Discord/Make) quando pedido → failed
│   ├── types/
│   │   ├── tray.ts                      ← TrayOrderComplete, TrayCustomer, TrayProduct, TrayOrderItem, etc
│   │   └── linx.ts                      ← LinxClienteResult, LinxStockApiItem, LinxOrderPayload, etc
│   ├── routes/
│   │   ├── webhook.ts                   ← POST /webhooks/tray/orders (thin webhook, zod validation)
│   │   ├── health.ts                    ← GET /health
│   │   ├── admin.ts                     ← GET /admin/queue, POST /admin/reprocess/:scopeId, POST /admin/reprocess-failed
│   │   └── debug.ts                     ← GET /simulate-linx (bloqueado em production)
│   ├── workers/
│   │   ├── process-order.ts             ← Polling 30s: consome order_queue (5 por ciclo, lock isProcessing)
│   │   └── recover-stuck.ts             ← Polling 5min: reseta pedidos travados em "processing" > 5min
│   ├── jobs/
│   │   └── sync-stock.ts               ← Cron 01:00 BRT: estoque Linx → Tray (lotes de 10, salva sync_logs)
│   └── services/
│       ├── tray/
│       │   ├── auth.ts                  ← Token via tabela tray_tokens (renova se < 1h de validade)
│       │   ├── orders.ts                ← getTrayOrderComplete(orderId) → GET /orders/{id}/complete
│       │   └── products.ts              ← getTrayProductByReference, updateTrayStock
│       └── linx/
│           ├── stock.ts                 ← fetchStockFromLinx() → POST /ConsultaPecaGerencial
│           └── orders.ts                ← sendOrderToLinx() → 3 passos: cliente → contato → itens
├── scripts/
│   └── test-stock-sync.mjs              ← Script teste end-to-end (2 produtos Linx → Tray)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql       ← Schema: order_queue, tray_tokens, sync_logs + triggers
├── Linx API.postman_collection.json     ← Collection Postman com endpoints Linx AutoShop
├── Dockerfile                           ← Multi-stage build (Node 22 Alpine)
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dois fluxos do sistema

### Fluxo 1 — Sync de estoque (Linx → Tray)

Cron diário às 01:00 BRT. Arquivo: `src/jobs/sync-stock.ts`

```
cron 01:00 BRT
  → getTrayToken() — busca/renova token do Supabase
  → fetchStockFromLinx() — POST /ConsultaPecaGerencial
      retorna array com ItemEstoque + QuantidadeDisponivel
  → Para cada produto (lotes de 10):
      → getTrayProductByReference(ItemEstoque, token)
          GET /web_api/products/?reference={ItemEstoque}
      → updateTrayStock(productId, stock, token)
          PUT /web_api/products/{id}
  → Salva resultado em sync_logs (Supabase)
      {sync_type: 'stock', status: 'success'|'partial'|'error', details: [...]}
```

### Fluxo 2 — Pedidos (Tray → Linx)

Webhook + fila assíncrona. Arquivos: `src/routes/webhook.ts` + `src/workers/process-order.ts`

```
Tray POST /webhooks/tray/orders
  body: { scope_name: "order", scope_id: "12345" }
  → zod valida payload (aceita scope_id string ou number)
  → Se scope_name !== 'order' → ignora, retorna 200
  → UPSERT order_queue (scope_id, status='pending') com ON CONFLICT deduplicação
  → Responde 200 OK imediatamente

Worker (polling 30s, max 5 pedidos por ciclo):
  → SELECT * FROM order_queue WHERE status='pending' ORDER BY created_at LIMIT 5
  → Para cada pedido:
      → UPDATE status='processing', attempts++
      → getTrayToken()
      → getTrayOrderComplete(scopeId, token)
          GET /web_api/orders/{id}/complete?access_token={token}
          Retorna: Order, Customer, CustomerAddresses, ProductsSold, Payment, OrderInvoice
      → Salva tray_order_data no banco (JSONB)
      → sendOrderToLinx(trayOrderData):
          Passo 1: buscarClienteLinx(cpf/cnpj)
              POST /Geral/ConsultaClientes/ConsultaClientesPaginado
          Passo 2: inserirContato(clienteLinx, trayOrder)
              POST /Pecas/AtendimentoBalcao/Atendimento/InserirContato
              Retorna contatoId (número do atendimento)
          Passo 3: inserirItem(contatoId, item) × N produtos
              POST /Pecas/AtendimentoBalcao/Atendimento/InserirItem
      → UPDATE status='done', linx_response={...}, processed_at=NOW()
      → Se erro: status='pending' (retry) ou 'failed' (após 3 tentativas)
      → Se failed: sendFailureAlert() via ALERT_WEBHOOK_URL

Recover stuck (polling 5min, arquivo: src/workers/recover-stuck.ts):
  → SELECT WHERE status='processing' AND updated_at < NOW() - 5min
  → UPDATE status='pending' (crash recovery)
```

---

## Banco de dados (Supabase PostgreSQL)

### Tabelas

**`order_queue`** — fila de pedidos

| Coluna | Tipo | Default | Descrição |
|---|---|---|---|
| id | BIGSERIAL | auto | PK |
| scope_id | TEXT | — | ID pedido Tray (UNIQUE — chave deduplicação) |
| status | TEXT | 'pending' | pending → processing → done / failed |
| attempts | INTEGER | 0 | Tentativas realizadas |
| max_attempts | INTEGER | 3 | Limite |
| tray_order_data | JSONB | null | Response completo de /orders/{id}/complete |
| linx_response | JSONB | null | Response da Linx |
| error_message | TEXT | null | Último erro |
| created_at | TIMESTAMPTZ | NOW() | — |
| updated_at | TIMESTAMPTZ | NOW() | Auto-update via trigger |
| processed_at | TIMESTAMPTZ | null | Quando foi concluído |

Índices: `idx_order_queue_status`, `idx_order_queue_created`

**`tray_tokens`** — tokens Tray

| Coluna | Tipo | Descrição |
|---|---|---|
| store_id | TEXT UNIQUE | Identificador da loja ('partsbarao') |
| access_token | TEXT | Token ativo |
| refresh_token | TEXT | Token de refresh |
| expires_at | TIMESTAMPTZ | Expiração |
| api_host | TEXT | Host da API |
| raw_response | JSONB | Response bruto da auth |

**`sync_logs`** — histórico de syncs

| Coluna | Tipo | Descrição |
|---|---|---|
| sync_type | TEXT | 'stock' |
| status | TEXT | 'success' / 'partial' / 'error' |
| total_items | INTEGER | Total processados |
| success_count / error_count | INTEGER | Contadores |
| duration_ms | INTEGER | Duração total |
| details | JSONB | Array com status por produto |

Triggers: `update_updated_at()` em order_queue e tray_tokens.

---

## Variáveis de ambiente

Validadas por zod em `src/lib/env.ts`. Processo morre no startup se faltar alguma obrigatória.

```env
# Obrigatórias
PORT=3000
NODE_ENV=development|production|test
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
TRAY_CONSUMER_KEY=
TRAY_CONSUMER_SECRET=
TRAY_AUTH_CODE=
TRAY_STORE_URL=https://www.partsbarao.com.br
LINX_API_URL=https://auto-gwsmartapi.linx.com.br  (tem default no zod)
LINX_SUBSCRIPTION_KEY=
LINX_AMBIENTE=

# Opcionais
WEBHOOK_SECRET=               # Validar requests da Tray (não implementado ainda)
ALERT_WEBHOOK_URL=            # URL para alertas quando pedido → failed (Slack/Discord/Make)
ADMIN_API_KEY=                # Proteger rotas /admin (Bearer token)
```

---

## APIs externas

### Tray Commerce

Base: `{TRAY_STORE_URL}/web_api`

| Método | Endpoint | Uso no código |
|---|---|---|
| POST | `/web_api/auth` | Gerar/renovar token (`tray/auth.ts`) |
| GET | `/web_api/orders/{id}/complete?access_token={token}` | Pedido completo (`tray/orders.ts`) |
| GET | `/web_api/products/?reference={ref}&access_token={token}` | Buscar produto por referência (`tray/products.ts`) |
| PUT | `/web_api/products/{id}?access_token={token}` | Atualizar estoque (`tray/products.ts`) |

**Token Tray — comportamento confirmado:**
- Validade: ~3 horas
- Renovação: `POST /web_api/auth` com `consumer_key + consumer_secret + code`
- `TRAY_AUTH_CODE` é permanente (reutilizável a cada renovação)
- **Nunca incluir `refresh_token` na renovação** — a API retorna o token antigo expirado nesse caso
- Token com < 1h de validade → renova automaticamente

### Linx AutoShop e-Commerce Premium

Base: `{LINX_API_URL}/api-e-commerce-premium`

| Método | Endpoint | Uso no código |
|---|---|---|
| POST | `/ConsultaPecaGerencial` | Buscar estoque de peças (`linx/stock.ts`) |
| POST | `/Geral/ConsultaClientes/ConsultaClientesPaginado` | Buscar cliente por CPF/CNPJ (`linx/orders.ts`) |
| POST | `/Pecas/AtendimentoBalcao/Atendimento/InserirContato` | Criar atendimento/pedido (`linx/orders.ts`) |
| POST | `/Pecas/AtendimentoBalcao/Atendimento/InserirItem` | Inserir item no atendimento (`linx/orders.ts`) |

Headers Linx (todas as chamadas):
```
Content-Type: application/json-patch+json
Cache-Control: no-cache
Ocp-Apim-Subscription-Key: {LINX_SUBSCRIPTION_KEY}
Ambiente: {LINX_AMBIENTE}
Authorization: (vazio)
```

CONFIG_ORIGEM padrão:
```json
{ "Empresa": 1, "Revenda": 1, "Usuario": 0, "CodigoOrigem": 0, "IdentificadorOrigem": "" }
```

---

## Cron jobs ativos (3)

| Cron | Expressão | Arquivo | Descrição |
|---|---|---|---|
| Sync estoque | `0 1 * * *` (01:00 BRT) | `jobs/sync-stock.ts` | Linx → Tray, lotes de 10 |
| Worker pedidos | `*/30 * * * * *` (30s) | `workers/process-order.ts` | Consome order_queue, max 5/ciclo |
| Recover stuck | `*/5 * * * *` (5min) | `workers/recover-stuck.ts` | Reseta pedidos travados > 5min |

---

## Rotas HTTP

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | pública | Health check + status Supabase |
| POST | `/webhooks/tray/orders` | pública | Thin webhook da Tray |
| GET | `/admin/queue` | ADMIN_API_KEY | Resumo da fila (contagem por status) |
| POST | `/admin/reprocess/:scopeId` | ADMIN_API_KEY | Reenfileira pedido específico (reseta attempts=0) |
| POST | `/admin/reprocess-failed` | ADMIN_API_KEY | Reenfileira TODOS os pedidos com status=failed |
| GET | `/simulate-linx` | dev only | Teste de consulta à Linx (bloqueado em prod) |

Auth admin: header `Authorization: Bearer {ADMIN_API_KEY}`. Se ADMIN_API_KEY não configurada → 403.

---

## Scripts

```bash
npm run dev         # tsx watch src/index.ts (hot reload)
npm run build       # tsc → dist/
npm start           # node dist/index.js (produção)
```

Teste manual:
```bash
node scripts/test-stock-sync.mjs   # Testa sync com 2 produtos (precisa .env preenchido)
```

---

## Deploy (Railway)

Dockerfile multi-stage: builder (npm ci + tsc) → produção (dist/ + node_modules, Node 22 Alpine).
Git push → Railway detecta Dockerfile → build → deploy.

---

## TODOs e pendências

### Bloqueadores para produção
- [ ] Criar projeto Supabase e executar `supabase/migrations/001_initial_schema.sql`
- [ ] Preencher `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **Validar body do `InserirContato`** — collection Postman tem payload incorreto. Confirmar com Linx. → `src/services/linx/orders.ts:79-90` (TODO no código)
- [ ] **Validar mapeamento `reference` Tray → `ItemEstoque` Linx** — confirmar se bate direto ou precisa busca intermediária. → `src/services/linx/orders.ts:209-210` (TODO no código)
- [ ] URL pública HTTPS para webhooks (ngrok dev / Railway prod)
- [ ] Cadastrar webhook no painel Tray → `/webhooks/tray/orders`

### Tipos incompletos (marcados com TODO no código)
- [ ] `TrayOrderComplete.Payment` → `unknown` em `src/types/tray.ts:63`
- [ ] `TrayOrderComplete.OrderInvoice` → `unknown` em `src/types/tray.ts:64`
- [ ] `LinxInserirContatoResponse` → `Record<string, unknown>` em `src/types/linx.ts:30`
- [ ] `LinxInserirItemResponse` → `Record<string, unknown>` em `src/types/linx.ts:31`

### Melhorias futuras
- [ ] Implementar validação de assinatura webhook via WEBHOOK_SECRET
- [ ] GET /admin/queue com filtro por status e paginação
- [ ] Métricas: tempo médio de processamento, taxa de sucesso
- [ ] Rate limiting no webhook

---

## Regras de código

1. **TypeScript strict** — nenhum `.js` em `src/`. `any` somente em responses de API não tipados (marcar `// TODO: tipar`)
2. **Sem credenciais no código** — tudo em `process.env`, validado por zod
3. **Sem URLs hardcoded** — toda URL de API vem de env var
4. **pino para todos os logs** — nunca `console.log` em `src/`. Usar `logger.info()`, `.error()`, `.warn()`, `.debug()`
5. **Child loggers** — `logger.child({ scopeId })` para contexto de pedido
6. **Deduplicação** — UPSERT com ON CONFLICT (scope_id) na order_queue
7. **Retry automático** — falha → pending → retry 30s depois. Após 3 → failed + alerta
8. **Lock de concorrência** — flag `isProcessing` no worker impede sobreposição
9. **ESM** — imports com extensão `.js` (`import { x } from './file.js'`)
10. **Não quebrar sync de estoque** — testado via `scripts/test-stock-sync.mjs`
11. **Máscara de dados sensíveis** — CPF/CNPJ mascarado nos logs (`***...123`)
12. **Salvar antes de processar** — `tray_order_data` é salvo no Supabase ANTES de enviar pra Linx
