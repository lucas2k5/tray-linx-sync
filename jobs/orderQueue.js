import { Queue, Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { getTrayToken, getTrayOrderComplete } from '../services/trayService.js';
import { sendOrderToLinx } from '../services/linxOrderService.js';

const QUEUE_NAME = 'tray-orders';

const orderQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Aguarda 8s antes de processar para absorver atualizações rápidas consecutivas do mesmo pedido
export async function enqueueOrder(scopeId) {
  await orderQueue.add(
    'process-order',
    { scopeId },
    {
      jobId: String(scopeId),
      delay: 8000,
    }
  );
  console.log(`📥 Pedido ${scopeId} enfileirado para processamento.`);
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { scopeId } = job.data;
    console.log(`⚙️ Processando pedido ${scopeId} (tentativa ${job.attemptsMade + 1})...`);

    const token = await getTrayToken();
    const orderData = await getTrayOrderComplete(scopeId, token);
    console.log(`✅ Dados completos do pedido ${scopeId} recebidos da Tray.`);

    await sendOrderToLinx(orderData);
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

worker.on('completed', (job) => {
  console.log(`✅ Pedido ${job.data.scopeId} processado com sucesso.`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Falha ao processar pedido ${job?.data?.scopeId}:`, err.message);
});

export default orderQueue;
