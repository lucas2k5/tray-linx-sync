import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';

export const healthRoutes = new Hono();

healthRoutes.get('/health', async (c) => {
  const { error } = await supabase.from('order_queue').select('id').limit(1);
  return c.json({
    status: error ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    db: error ? 'down' : 'up',
  });
});
