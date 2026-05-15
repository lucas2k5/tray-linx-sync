import { Hono } from 'hono';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const webhookPayloadSchema = z.object({
  scope_id: z.union([z.string(), z.number()]).transform(String),
  scope_name: z.string(),
  act: z.string().optional(),
  seller_id: z.union([z.string(), z.number()]).optional(),
  topic: z.string().optional(),
}).passthrough();

export const webhookRoutes = new Hono();

webhookRoutes.post('/orders', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  logger.info({ body }, 'Webhook recebido da Tray');

  const parsed = webhookPayloadSchema.safeParse(body);

  if (!parsed.success || parsed.data.scope_name !== 'order') {
    logger.warn({ body }, 'Webhook ignorado: não é pedido ou payload inválido');
    return c.json({ ok: true, message: 'Ignorado' });
  }

  const scopeId = parsed.data.scope_id.trim();
  if (!scopeId) {
    return c.json({ ok: true, message: 'scope_id vazio' });
  }

  const { error } = await supabase
    .from('order_queue')
    .upsert(
      { scope_id: scopeId, status: 'pending', attempts: 0, error_message: null },
      { onConflict: 'scope_id' }
    );

  if (error) {
    logger.error({ error, scopeId }, 'Erro ao enfileirar pedido');
  } else {
    logger.info({ scopeId }, 'Pedido enfileirado');
  }

  return c.json({ ok: true });
});
