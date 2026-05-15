import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import syncStock from './jobs/syncStock.js';
import { enqueueOrder } from './jobs/orderQueue.js';
import { fetchStockFromLinx } from './services/linxService.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.send('API de sincronização ativa'));

app.get('/simulate-linx', async (req, res) => {
  const data = await fetchStockFromLinx();
  res.json(data);
});

app.post('/webhooks/tray/v1/orders', async (req, res) => {
  const payload = req.body || {};
  const scopeName = payload.scope_name ?? payload.scopeName ?? '';
  const scopeIdRaw = payload.scope_id ?? payload.scopeId;
  const scopeId = scopeIdRaw ? String(scopeIdRaw).trim() : '';

  res.status(200).json({ ok: true });

  if (scopeName !== 'order') {
    console.log(`📥 Webhook ignorado (scope_name="${scopeName}")`);
    return;
  }

  if (!scopeId) {
    console.warn('⚠️ Webhook de pedido recebido sem scope_id.');
    return;
  }

  console.log(`📥 Webhook recebido — pedido ${scopeId} enfileirado.`);
  enqueueOrder(scopeId).catch((err) =>
    console.error(`❌ Erro ao enfileirar pedido ${scopeId}:`, err.message)
  );
});

cron.schedule('0 1 * * *', () => {
  console.log('⏰ Rodando sincronização diária às 01:00 (America/Sao_Paulo)...');
  syncStock();
}, {
  timezone: 'America/Sao_Paulo'
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`🔗 Webhook Tray: ${BASE_URL}/webhooks/tray/v1/orders`);
});
