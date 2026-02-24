import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import syncStock from './jobs/syncStock.js';
import { fetchStockFromLinx } from './services/linxService.js';
import { getTrayToken, getTrayOrderDetails } from './services/trayService.js';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Parse JSON and x-www-form-urlencoded payloads for webhook requests
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.send('API de sincronização ativa'));

app.get('/simulate-linx', async (req, res) => {
  const data = await fetchStockFromLinx();
  res.json(data);
});

// Webhook endpoint for Tray events
app.post('/webhooks/tray/v1/orders', async (req, res) => {
  const payload = req.body || {};
  console.log('📥 Webhook recebido da Tray:', payload);

  const scopeIdRaw = payload.scope_id ?? payload.scopeId;
  const scopeId = scopeIdRaw ? String(scopeIdRaw).trim() : '';

  if (!scopeId) {
    console.warn('⚠️ Webhook recebido sem scope_id; nada para buscar.');
    return res.status(200).json({ ok: true, message: 'Webhook sem scope_id' });
  }

  try {
    const trayToken = await getTrayToken();
    const orderDetails = await getTrayOrderDetails(scopeId, trayToken);
    console.log('📦 Detalhes completos do pedido:', orderDetails);
  } catch (err) {
    console.error('❌ Erro ao buscar detalhes do pedido na Tray:', err.message);
    if (err.response) console.error('📦 Response da API Tray:', err.response.data);
  }

  res.status(200).json({ ok: true });
});

// Executa diariamente às 01:00 (horário de Brasília)
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
