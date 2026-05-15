import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { getTrayToken } from '../services/tray/auth.js';
import { getTrayProductByReference, updateTrayStock } from '../services/tray/products.js';
import { fetchStockFromLinx } from '../services/linx/stock.js';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

interface ProductStatus {
  reference: string;
  stock: number;
  status: string;
  message: string;
}

export async function syncStock(): Promise<void> {
  const startedAt = Date.now();
  logger.info('Iniciando sincronização de estoque');

  const summary: ProductStatus[] = [];

  try {
    const token = await getTrayToken();
    logger.info('Token Tray obtido');

    const linxProducts = await fetchStockFromLinx();
    if (!linxProducts.length) {
      logger.warn('Nenhum produto retornado da Linx');
      return;
    }

    logger.info({ total: linxProducts.length }, 'Produtos recebidos da Linx');

    const batches = chunkArray(linxProducts, 10);

    for (const [index, batch] of batches.entries()) {
      logger.debug({ batch: index + 1, total: batches.length }, 'Processando lote');

      for (const produto of batch) {
        const entry: ProductStatus = {
          reference: produto.trayProductId,
          stock: produto.stock,
          status: '',
          message: '',
        };

        if (!produto.trayProductId) {
          entry.status = 'skipped';
          entry.message = 'Produto sem trayProductId';
          logger.warn('Produto sem referência, ignorado');
          summary.push(entry);
          continue;
        }

        try {
          const trayProduct = await getTrayProductByReference(produto.trayProductId, token);

          if (trayProduct?.id) {
            await updateTrayStock(trayProduct.id, produto.stock, token);
            entry.status = 'updated';
            entry.message = `ID Tray: ${trayProduct.id}`;
            logger.debug({ ref: produto.trayProductId, id: trayProduct.id }, 'Estoque atualizado');
          } else {
            entry.status = 'not_found';
            entry.message = 'Produto não encontrado na Tray';
            logger.warn({ ref: produto.trayProductId }, 'Produto não encontrado na Tray');
          }
        } catch (err: unknown) {
          entry.status = 'error';
          entry.message = err instanceof Error ? err.message : String(err);
          logger.error({ ref: produto.trayProductId, err: entry.message }, 'Erro ao atualizar produto');
        }

        summary.push(entry);
      }
    }

    const updated = summary.filter((p) => p.status === 'updated').length;
    const notFound = summary.filter((p) => p.status === 'not_found').length;
    const skipped = summary.filter((p) => p.status === 'skipped').length;
    const errors = summary.filter((p) => p.status === 'error').length;
    const durationMs = Date.now() - startedAt;

    logger.info({ updated, notFound, skipped, errors, durationMs }, 'Sincronização concluída');

    // Salva log no Supabase
    await supabase.from('sync_logs').insert({
      sync_type: 'stock',
      status: errors === 0 ? 'success' : 'partial',
      total_items: summary.length,
      success_count: updated,
      error_count: errors,
      duration_ms: durationMs,
      details: summary as unknown as Record<string, unknown>[],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'Erro geral na sincronização de estoque');

    await supabase.from('sync_logs').insert({
      sync_type: 'stock',
      status: 'error',
      total_items: 0,
      success_count: 0,
      error_count: 1,
      duration_ms: Date.now() - startedAt,
      details: { error: msg } as unknown as Record<string, unknown>[],
    });
  }
}
