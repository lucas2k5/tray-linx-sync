// syncStock.js
const { fetchStockFromLinx } = require('../services/linxService');
const { getTrayProduct, updateTrayStock } = require('../services/trayService');
const { getTrayToken } = require('../services/tokenService'); // novo serviço para gerenciar token

module.exports = async function syncStock() {
  console.log('🚀 Iniciando sincronização de estoque...');

  try {
    // Obtém o token centralizado (só renova se estiver perto de expirar)
    const trayToken = await getTrayToken();

    // Busca estoque da Linx
    const produtosLinx = await fetchStockFromLinx();

    // Processa apenas os 10 primeiros (como você já fazia)
    const primeiros10 = produtosLinx.slice(0, 10);

    for (const produto of primeiros10) {
      try {
        const produtoTray = await getTrayProduct(produto.trayProductId, trayToken);

        if (produtoTray && produtoTray.Product?.id) {
          const trayId = produtoTray.Product.id;
          await updateTrayStock(trayId, produto.stock, trayToken);
          console.log(`✅ Estoque atualizado na Tray -> Produto ${trayId} com estoque ${produto.stock}`);
        } else {
          console.warn(`⚠️ Produto com CodigoItemParcial ${produto.trayProductId} não encontrado na Tray.`);
        }
      } catch (err) {
        console.error(`❌ Erro ao atualizar produto ${produto.trayProductId}:`, err.message);
      }
    }

    console.log('🎉 Sincronização concluída.');
  } catch (err) {
    console.error('🔥 Erro geral na sincronização:', err.message);
  }
};
