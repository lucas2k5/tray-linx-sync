const { fetchStockFromLinx } = require('../services/linxService');
const { getTrayToken, getTrayProduct, updateTrayStock } = require('../services/trayService');

module.exports = async function syncStock() {
  console.log('🚀 Iniciando sincronização de estoque...');
  
  const trayToken = await getTrayToken();
  const produtosLinx = await fetchStockFromLinx();

  const primeiros10 = produtosLinx.slice(0, 10);

  for (const produto of primeiros10) {
    const produtoTray = await getTrayProduct(produto.trayProductId, trayToken);

    if (produtoTray && produtoTray.Product?.id) {
      const trayId = produtoTray.Product.id;
      await updateTrayStock(trayId, produto.stock, trayToken);
    } else {
      console.warn(`⚠️ Produto com CodigoItemParcial ${produto.trayProductId} não encontrado na Tray.`);
    }
  }

  console.log('✅ Sincronização concluída.');
};
