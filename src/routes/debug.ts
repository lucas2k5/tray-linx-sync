import { Hono } from 'hono';
import axios from 'axios';
import { env } from '../lib/env.js';
import { fetchStockFromLinx } from '../services/linx/stock.js';
import { getTrayToken } from '../services/tray/auth.js';
import { getTrayOrderComplete } from '../services/tray/orders.js';

export const debugRoutes = new Hono();

debugRoutes.get('/simulate-linx', async (c) => {
  if (env.NODE_ENV === 'production') {
    return c.json({ error: 'Não disponível em produção' }, 403);
  }
  const data = await fetchStockFromLinx();
  return c.json(data);
});

// Busca pedidos recentes da Tray e retorna o primeiro completo
debugRoutes.get('/simulate-tray-order', async (c) => {
  if (env.NODE_ENV === 'production') {
    return c.json({ error: 'Não disponível em produção' }, 403);
  }

  const token = await getTrayToken();

  // Lista os 5 pedidos mais recentes
  const listResp = await axios.get(`${env.TRAY_STORE_URL}/web_api/orders/`, {
    params: { access_token: token, limit: 5, sort: 'date', order: 'desc' },
  });

  const orders = listResp.data?.Orders ?? [];
  if (!orders.length) {
    return c.json({ message: 'Nenhum pedido encontrado na Tray' });
  }

  // Pega o ID do pedido mais recente e busca completo
  const firstId = String(orders[0]?.Order?.id ?? orders[0]?.id);
  const complete = await getTrayOrderComplete(firstId, token);

  return c.json({ total: orders.length, fetched_id: firstId, order: complete });
});
