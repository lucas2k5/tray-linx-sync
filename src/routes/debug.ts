import { Hono } from 'hono';
import { env } from '../lib/env.js';
import { fetchStockFromLinx } from '../services/linx/stock.js';

export const debugRoutes = new Hono();

debugRoutes.get('/simulate-linx', async (c) => {
  if (env.NODE_ENV === 'production') {
    return c.json({ error: 'Não disponível em produção' }, 403);
  }
  const data = await fetchStockFromLinx();
  return c.json(data);
});
