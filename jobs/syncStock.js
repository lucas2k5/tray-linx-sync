// jobs/syncStock.js
import { fetchStockFromLinx } from '../services/linxService.js';
import { getTrayToken, getTrayProductByReference, updateTrayStock } from '../services/trayService.js';

export default async function syncStock() {
  console.log('🚀 Iniciando sincronização de estoque...');

  try {
    // Obtém token válido
    const trayToken = await getTrayToken();
    if (!trayToken) throw new Error('Não foi possível obter token da Tray');

    // Busca estoque da Linx
    const produtosLinx = await fetchStockFromLinx();
    if (!produtosLinx || produtosLinx.length === 0) {
      console.warn('⚠️ Nenhum produto retornado da Linx');
      return;
    }

    const primeiros10 = produtosLinx.slice(0, 10);

    for (const produto of primeiros10) {
      try {
        const produtoTray = await getTrayProductByReference(produto.trayProductId, trayToken);

        if (produtoTray && produtoTray.id) {
          const trayId = produtoTray.id;
          await updateTrayStock(trayId, produto.stock, trayToken);
          console.log(`✅ Estoque atualizado na Tray -> Produto ${trayId} com estoque ${produto.stock}`);
        } else {
          console.warn(`⚠️ Produto com CodigoItemParcial ${produto.trayProductId} não encontrado na Tray.`);
        }
      } catch (err) {
        // Corrigido: produto definido dentro do loop
        console.error(`❌ Erro ao atualizar produto ${produto.trayProductId}:`, err.message);
        if (err.response) {
          console.error('📦 Response da API:', err.response.data);
        }
      }
    }

    console.log('🎉 Sincronização concluída.');
  } catch (err) {
    console.error('🔥 Erro geral na sincronização:', err.message);
    if (err.response) {
      console.error('📦 Response da API:', err.response.data);
    }
  }
}
