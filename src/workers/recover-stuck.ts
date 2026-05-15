import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const STUCK_THRESHOLD_MINUTES = 5;

// Pedidos travados em "processing" por mais de 5 minutos indicam crash do servidor
// durante o processamento. Esta função os reseta para "pending" para reprocessamento.
export async function recoverStuckOrders(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: stuck, error: fetchError } = await supabase
    .from('order_queue')
    .select('scope_id, attempts, updated_at')
    .eq('status', 'processing')
    .lt('updated_at', threshold);

  if (fetchError) {
    logger.error({ error: fetchError }, 'Erro ao buscar pedidos travados');
    return;
  }

  if (!stuck?.length) return;

  logger.warn({ count: stuck.length }, 'Pedidos travados em "processing" encontrados — resetando para "pending"');

  for (const order of stuck) {
    const { error: updateError } = await supabase
      .from('order_queue')
      .update({
        status: 'pending',
        error_message: `Recuperado de estado "processing" travado por mais de ${STUCK_THRESHOLD_MINUTES} min`,
      })
      .eq('scope_id', order.scope_id)
      .eq('status', 'processing');

    if (updateError) {
      logger.error({ scopeId: order.scope_id, error: updateError }, 'Erro ao resetar pedido travado');
    } else {
      logger.info({ scopeId: order.scope_id }, 'Pedido travado resetado para "pending"');
    }
  }
}
