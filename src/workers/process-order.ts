import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { sendFailureAlert } from '../lib/alerts.js';
import { getTrayToken } from '../services/tray/auth.js';
import { getTrayOrderComplete } from '../services/tray/orders.js';
import { sendOrderToLinx } from '../services/linx/orders.js';

interface ProcessingStep {
  step: string;
  ok: boolean;
  at: string;
  [key: string]: unknown;
}

function step(name: string, ok: boolean, extra?: Record<string, unknown>): ProcessingStep {
  return { step: name, ok, at: new Date().toISOString(), ...extra };
}

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
  const steps: ProcessingStep[] = [];

  log.info({ attempt: attempts + 1 }, 'Processando pedido');

  await supabase
    .from('order_queue')
    .update({ status: 'processing', attempts: attempts + 1 })
    .eq('scope_id', scopeId);

  try {
    // Step 1 — buscar token Tray
    const token = await getTrayToken();
    steps.push(step('tray_token', true));

    // Step 2 — buscar pedido completo na Tray
    const trayOrderData = await getTrayOrderComplete(scopeId, token);
    const orderNode = (trayOrderData as Record<string, unknown>)?.Order as Record<string, unknown> | undefined;
    const trayStatus = String(orderNode?.status ?? '').toUpperCase();
    const customerName = (orderNode?.Customer as Record<string, unknown> | undefined)?.name as string | undefined;
    const qtdItens = Array.isArray(orderNode?.ProductsSold) ? orderNode.ProductsSold.length : 0;
    const rawTotal = orderNode?.total;
    const orderValue = rawTotal != null ? (parseFloat(String(rawTotal)) || 0) : null;
    const paymentMethod = String(orderNode?.payment_method ?? '') || null;

    steps.push(step('tray_fetch', true, { trayStatus, customerName, qtdItens }));
    log.info({ trayStatus, customerName, qtdItens }, 'Pedido completo obtido da Tray');

    await supabase
      .from('order_queue')
      .update({
        tray_order_data: trayOrderData as unknown as Record<string, unknown>,
        customer_name: customerName ?? null,
        order_value: orderValue,
        items_count: qtdItens,
        payment_method: paymentMethod,
      })
      .eq('scope_id', scopeId);

    // Step 3 — filtro de status
    const STATUSES_ENVIAR = ['FINALIZADO', 'A ENVIAR'];
    if (!STATUSES_ENVIAR.includes(trayStatus)) {
      steps.push(step('status_filter', false, { trayStatus, motivo: 'status não elegível' }));
      log.info({ trayStatus }, 'Pedido ignorado — status não elegível para envio à Linx');
      await supabase
        .from('order_queue')
        .update({ status: 'skipped', processed_at: new Date().toISOString(), processing_steps: steps })
        .eq('scope_id', scopeId);
      return;
    }

    steps.push(step('status_filter', true, { trayStatus }));

    // Step 4 — enviar para Linx
    const linxResponse = await sendOrderToLinx(trayOrderData);
    steps.push(step('linx_send', true, {
      codigoCliente: linxResponse.codigoCliente,
      contatoId: linxResponse.contatoId,
      itensInseridos: linxResponse.itensInseridos,
      itensFalhados: linxResponse.itensFalhados,
    }));

    log.info({ contatoId: linxResponse.contatoId, itensInseridos: linxResponse.itensInseridos }, 'Pedido enviado à Linx com sucesso');

    await supabase
      .from('order_queue')
      .update({
        status: 'done',
        linx_response: linxResponse as unknown as Record<string, unknown>,
        processed_at: new Date().toISOString(),
        error_message: null,
        processing_steps: steps,
      })
      .eq('scope_id', scopeId);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Erro ao processar pedido');

    steps.push(step('error', false, { message: msg }));

    const newStatus = attempts + 1 >= maxAttempts ? 'failed' : 'pending';

    await supabase
      .from('order_queue')
      .update({ status: newStatus, error_message: msg, processing_steps: steps })
      .eq('scope_id', scopeId);

    if (newStatus === 'failed') {
      await sendFailureAlert({ scopeId, attempts: attempts + 1, errorMessage: msg });
    }
  }
}
