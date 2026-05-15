import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import type { TrayProduct, TrayProductResponse } from '../../types/tray.js';

export async function getTrayProductByReference(
  reference: string,
  token: string
): Promise<TrayProduct | null> {
  try {
    const response = await axios.get<TrayProductResponse>(
      `${env.TRAY_STORE_URL}/web_api/products/`,
      { params: { access_token: token, reference } }
    );

    const products = response.data.Products;
    if (!products || products.length === 0) return null;

    const p = products[0].Product;
    return {
      id: p.id,
      reference: p.reference,
      stock: parseInt(String(p.stock ?? 0)),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ reference, err: msg }, 'Erro ao buscar produto na Tray');
    return null;
  }
}

export async function updateTrayStock(
  productId: string | number,
  newStock: number,
  token: string
): Promise<boolean> {
  try {
    const response = await axios.put<{ id?: unknown }>(
      `${env.TRAY_STORE_URL}/web_api/products/${productId}`,
      { Product: { stock: newStock } },
      {
        headers: { 'Content-Type': 'application/json' },
        params: { access_token: token },
      }
    );

    return Boolean(response.data?.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ productId, err: msg }, 'Erro ao atualizar estoque na Tray');
    return false;
  }
}
