import { Hono } from 'hono';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

export const adminRoutes = new Hono();

// Middleware: valida ADMIN_API_KEY no header Authorization: Bearer <key>
adminRoutes.use('*', async (c, next) => {
  if (!env.ADMIN_API_KEY) {
    return c.json({ error: 'Rotas admin desabilitadas (ADMIN_API_KEY não configurada)' }, 403);
  }

  const auth = c.req.header('Authorization') ?? '';
  const key = auth.replace(/^Bearer\s+/i, '').trim();

  if (key !== env.ADMIN_API_KEY) {
    logger.warn({ ip: c.req.header('x-forwarded-for') }, 'Tentativa de acesso admin sem autorização');
    return c.json({ error: 'Não autorizado' }, 401);
  }

  await next();
});

// GET /admin/queue — resumo da fila
adminRoutes.get('/queue', async (c) => {
  const { data, error } = await supabase
    .from('order_queue')
    .select('status')
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);

  const summary = (data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return c.json({ summary, total: data?.length ?? 0 });
});

// POST /admin/reprocess/:scopeId — reprocessa um pedido específico
adminRoutes.post('/reprocess/:scopeId', async (c) => {
  const scopeId = c.req.param('scopeId');

  const { data: existing, error: fetchError } = await supabase
    .from('order_queue')
    .select('scope_id, status, attempts')
    .eq('scope_id', scopeId)
    .single();

  if (fetchError || !existing) {
    return c.json({ error: `Pedido ${scopeId} não encontrado` }, 404);
  }

  const { error: updateError } = await supabase
    .from('order_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('scope_id', scopeId);

  if (updateError) return c.json({ error: updateError.message }, 500);

  logger.info({ scopeId, previousStatus: existing.status }, 'Pedido reenfileirado manualmente');
  return c.json({ ok: true, scopeId, previousStatus: existing.status });
});

// POST /admin/reprocess-failed — reprocessa todos os pedidos com status "failed"
adminRoutes.post('/reprocess-failed', async (c) => {
  const { data: failed, error: fetchError } = await supabase
    .from('order_queue')
    .select('scope_id')
    .eq('status', 'failed');

  if (fetchError) return c.json({ error: fetchError.message }, 500);
  if (!failed?.length) return c.json({ ok: true, requeued: 0 });

  const { error: updateError } = await supabase
    .from('order_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('status', 'failed');

  if (updateError) return c.json({ error: updateError.message }, 500);

  logger.info({ count: failed.length }, 'Pedidos failed reenfileirados manualmente');
  return c.json({ ok: true, requeued: failed.length });
});
