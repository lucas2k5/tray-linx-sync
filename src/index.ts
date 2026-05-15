import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import cron from 'node-cron';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { webhookRoutes } from './routes/webhook.js';
import { healthRoutes } from './routes/health.js';
import { debugRoutes } from './routes/debug.js';
import { adminRoutes } from './routes/admin.js';
import { syncStock } from './jobs/sync-stock.js';
import { processOrderQueue } from './workers/process-order.js';
import { recoverStuckOrders } from './workers/recover-stuck.js';

const app = new Hono();

app.route('/webhooks/tray', webhookRoutes);
app.route('/', healthRoutes);
app.route('/', debugRoutes);
app.route('/admin', adminRoutes);

// Cron: sync estoque Linx → Tray diariamente às 01:00 (Brasília)
cron.schedule('0 1 * * *', async () => {
  logger.info('Cron: iniciando sync de estoque');
  await syncStock();
}, { timezone: 'America/Sao_Paulo' });

// Cron: processa fila de pedidos a cada 30 segundos
cron.schedule('*/30 * * * * *', async () => {
  await processOrderQueue();
});

// Cron: recupera pedidos travados em "processing" a cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  await recoverStuckOrders();
});

serve({ fetch: app.fetch, port: Number(env.PORT) }, (info) => {
  logger.info({ port: info.port }, 'Servidor iniciado');
  if (env.NODE_ENV !== 'production') {
    logger.info(`Webhook: POST http://localhost:${info.port}/webhooks/tray/orders`);
    logger.info(`Health:  GET  http://localhost:${info.port}/health`);
    logger.info(`Admin:   POST http://localhost:${info.port}/admin/reprocess/:scopeId`);
  }
});
