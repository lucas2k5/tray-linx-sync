// jobs/syncStock.js
import 'dotenv/config';
import { fetchStockFromLinx } from '../services/linxService.js';
import { getTrayToken, getTrayProductByReference, updateTrayStock } from '../services/trayService.js';

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export default async function syncStock() {
  console.log('🚀 Iniciando sincronização de estoque...');

  try {
    const trayToken = await getTrayToken();
    if (!trayToken) throw new Error('Não foi possível obter token da Tray');
    console.log('🔑 Token da Tray obtido com sucesso');

    const produtosLinx = await fetchStockFromLinx();
    if (!produtosLinx || produtosLinx.length === 0) {
      console.warn('⚠️ Nenhum produto retornado da Linx');
      return;
    }

    console.log(`📦 Total de produtos recebidos da Linx: ${produtosLinx.length}`);

    const statusResumo = [];

    const lotes = chunkArray(produtosLinx, 10); // divide em lotes de 10

    for (const [index, lote] of lotes.entries()) {
      console.log(`\n🔹 Processando lote ${index + 1} de ${lotes.length} (até 10 produtos)`);

      for (const produto of lote) {
        const statusProduto = {
          reference: produto.trayProductId,
          estoque: produto.stock,
          status: '',
          mensagem: ''
        };

        if (!produto.trayProductId) {
          statusProduto.status = '❌ Não enviado';
          statusProduto.mensagem = 'Produto sem CodigoItemParcial';
          console.warn(`⚠️ ${statusProduto.mensagem}`);
          statusResumo.push(statusProduto);
          continue;
        }

        try {
          const produtoTray = await getTrayProductByReference(produto.trayProductId, trayToken);

          if (produtoTray && produtoTray.id) {
            await updateTrayStock(produtoTray.id, produto.stock, trayToken);
            statusProduto.status = '✅ Atualizado';
            statusProduto.mensagem = `Estoque atualizado na Tray -> Produto ${produtoTray.id}`;
          } else {
            statusProduto.status = '⚠️ Não encontrado';
            statusProduto.mensagem = `Produto ${produto.trayProductId} não encontrado na Tray`;
          }
        } catch (err) {
          statusProduto.status = '❌ Erro';
          statusProduto.mensagem = err.message;
        }

        statusResumo.push(statusProduto);
      }
    }

    // Exibe resumo detalhado
    console.log('\n📊 Resumo da sincronização por produto:');
    statusResumo.forEach(p => {
      console.log(`${p.status} | Reference: ${p.reference} | Estoque: ${p.estoque} | ${p.mensagem}`);
    });

    // Estatísticas finais
    const totalAtualizados = statusResumo.filter(p => p.status === '✅ Atualizado').length;
    const totalNaoEncontrados = statusResumo.filter(p => p.status === '⚠️ Não encontrado').length;
    const totalNaoEnviados = statusResumo.filter(p => p.status === '❌ Não enviado').length;
    const totalErros = statusResumo.filter(p => p.status === '❌ Erro').length;

    console.log('\n📊 Estatísticas finais:');
    console.log(`✅ Produtos encontrados e atualizados: ${totalAtualizados}`);
    console.log(`⚠️ Produtos não encontrados: ${totalNaoEncontrados}`);
    console.log(`❌ Produtos sem CodigoItemParcial: ${totalNaoEnviados}`);
    console.log(`❌ Produtos com erro ao atualizar: ${totalErros}`);

    console.log('\n🎉 Sincronização concluída.');
  } catch (err) {
    console.error('🔥 Erro geral na sincronização:', err.message);
    if (err.response) console.error('📦 Response da API:', err.response.data);
  }
}
