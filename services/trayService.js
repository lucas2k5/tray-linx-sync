import axios from 'axios';
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.resolve('./tray-token.json');

export async function getTrayToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const expires = new Date(tokenData.date_expiration_access_token);
    const now = new Date();
    const hoursToExpire = (expires - now) / (1000 * 60 * 60);
    if (hoursToExpire > 24) return tokenData.access_token;
  }

  const payload = new URLSearchParams({
    consumer_key: process.env.TRAY_CONSUMER_KEY,
    consumer_secret: process.env.TRAY_CONSUMER_SECRET,
    code: process.env.TRAY_AUTH_CODE
  });

  const response = await axios.post(
    'https://www.partsbarao.com.br/web_api/auth',
    payload.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(response.data, null, 2));
  return response.data.access_token;
}

export async function getTrayProductByReference(reference, token) {
  try {
    const response = await axios.get(
      `https://www.partsbarao.com.br/web_api/products/?access_token=${token}&reference=${reference}`
    );

    if (response.data.Products && response.data.Products.length > 0) {
      const product = response.data.Products[0].Product;
      return {
        id: product.id,
        reference: product.reference,
        stock: parseInt(product.stock || 0)
      };
    }

    return null;
  } catch (err) {
    console.error(`❌ Erro ao buscar produto com reference ${reference}:`, err.message);
    if (err.response) console.error('📦 Response da API:', err.response.data);
    return null;
  }
}

export async function updateTrayStock(productId, newStock, token) {
  try {
    const response = await axios.put(
      `https://www.partsbarao.com.br/web_api/products/${productId}?access_token=${token}`,
      { Product: { stock: newStock } },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (response.data && response.data.id) return true;
    return false;
  } catch (err) {
    console.error(`❌ Erro ao atualizar estoque do produto ${productId}:`, err.message);
    if (err.response) console.error('📦 Response da API:', err.response.data);
    return false;
  }
}

export async function updateTrayProductsBatch(products) {
  const token = await getTrayToken();

  let encontrados = 0;
  let naoEncontrados = 0;
  let semReferencia = 0;
  let errosAtualizacao = 0;

  const resumoProdutos = [];

  for (let i = 0; i < products.length; i += 10) {
    const batch = products.slice(i, i + 10);
    console.log(`\n🔹 Processando lote ${i / 10 + 1} de ${Math.ceil(products.length / 10)} (até 10 produtos)`);

    for (const item of batch) {
      const trayReference = item.ItemEstoque;
      const newStock = item.CodigoEstoque || 0;

      if (!trayReference) {
        console.warn(`❌ Produto sem referência válida, estoque: ${newStock}`);
        semReferencia++;
        continue;
      }

      const product = await getTrayProductByReference(trayReference, token);

      if (!product) {
        console.warn(`⚠️ Produto não encontrado na Tray | Reference Linx: ${trayReference} | Estoque: ${newStock}`);
        naoEncontrados++;
        resumoProdutos.push({
          reference: trayReference,
          idTray: null,
          oldStock: null,
          newStock,
          status: 'Não encontrado'
        });
        continue;
      }

      const updated = await updateTrayStock(product.id, newStock, token);

      resumoProdutos.push({
        reference: trayReference,
        idTray: product.id,
        oldStock: product.stock,
        newStock,
        status: updated ? 'Atualizado' : 'Erro ao atualizar'
      });

      if (updated) encontrados++;
      else errosAtualizacao++;
    }
  }

  console.log(`\n📊 Resumo detalhado por produto:`);
  resumoProdutos.forEach(p => {
    console.log(`${p.status} | Reference Linx: ${p.reference} | ID Tray: ${p.idTray} | Estoque antigo: ${p.oldStock} | Novo estoque: ${p.newStock}`);
  });

  console.log(`\n📊 Estatísticas finais:`);
  console.log(`✅ Produtos encontrados e atualizados: ${encontrados}`);
  console.log(`⚠️ Produtos não encontrados: ${naoEncontrados}`);
  console.log(`❌ Produtos sem referência: ${semReferencia}`);
  console.log(`❌ Produtos com erro ao atualizar: ${errosAtualizacao}`);
}
