const { fetchStockFromLinx } = require('../services/linxService');
const { updateStock } = require('../services/trayService');

const TRAY_ACCESS_TOKEN = 'SEU_ACCESS_TOKEN_FIXO';

async function syncStock() {
  console.log('🔁 Iniciando sincronização de estoque...');
  const estoque = await fetchStockFromLinx();

  for (const item of estoque) {
    try {
      await updateStock(item.sku, item.quantity, TRAY_ACCESS_TOKEN);
      console.log(`✅ Produto ${item.sku} atualizado com ${item.quantity} unidades.`);
    } catch (err) {
      console.error(`❌ Erro ao atualizar produto ${item.sku}`, err.message);
    }
  }

  console.log('✅ Sincronização concluída.');
}

module.exports = syncStock;

