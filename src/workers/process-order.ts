import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { getTrayToken } from '../services/tray/auth.js';
import { getTrayOrderComplete } from '../services/tray/orders.js';
import { sendOrderToLinx } from '../services/linx/orders.js';

let isProcessing = false;

export async function processOrderQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { data: pending, error } = await supabase
      .from('order_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      logger.error({ error }, 'Erro ao consultar fila de pedidos');
      return;
    }

    if (!pending?.length) return;

    logger.info({ count: pending.length }, 'Pedidos pendentes encontrados');

    for (const order of pending) {
      await processOrder(order);
    }
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Erro geral no worker');
  } finally {
    isProcessing = false;
  }
}

async function processOrder(order: Record<string, unknown>): Promise<void> {
  const scopeId = String(order['scope_id']);
  const attempts = Number(order['attempts'] ?? 0);
  const maxAttempts = Number(order['max_attempts'] ?? 3);
  const log = logger.child({ scopeId });

  log.info({ attempt: attempts + 1 }, 'Processando pedido');

  await supabase
    .from('order_queue')
    .update({ status: 'processing', attempts: attempts + 1 })
    .eq('scope_id', scopeId);

  try {
    const token = await getTrayToken();
    const trayOrderData = await getTrayOrderComplete(scopeId, token);
    log.info('Pedido completo obtido da Tray');

    await supabase
      .from('order_queue')
      .update({ tray_order_data: trayOrderData as unknown as Record<string, unknown> })
      .eq('scope_id', scopeId);

    const linxResponse = await sendOrderToLinx(trayOrderData);

    await supabase
      .from('order_queue')
      .update({
        status: 'done',
        linx_response: linxResponse as unknown as Record<string, unknown>,
        processed_at: new Date().toISOString(),
      })
      .eq('scope_id', scopeId);

    log.info('Pedido processado com sucesso');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Erro ao processar pedido');

    const newStatus = attempts + 1 >= maxAttempts ? 'failed' : 'pending';

    await supabase
      .from('order_queue')
      .update({ status: newStatus, error_message: msg })
      .eq('scope_id', scopeId);

    if (newStatus === 'failed') {
      log.error('Pedido marcado como FAILED após máximo de tentativas');
    }
  }
}
