import axios from 'axios'; // Biblioteca para fazer chamadas HTTP
import fs from 'fs';       // Biblioteca para manipulação de arquivos
import path from 'path';   // Biblioteca para manipulação de caminhos de arquivos

// Caminho absoluto onde será salvo o token da Tray em disco
const TOKEN_PATH = path.resolve('./tray-token.json');

// 🔹 Recupera token da Tray (busca em arquivo ou gera novo se necessário)
export async function getTrayToken() {
  // Se já existe um token salvo em disco
  if (fs.existsSync(TOKEN_PATH)) {
    // Lê conteúdo do arquivo JSON
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const expires = new Date(tokenData.date_expiration_access_token); // Data de expiração
    const now = new Date(); // Data atual

    // Calcula em horas quanto falta para expirar
    const hoursToExpire = (expires - now) / (1000 * 60 * 60);

    // Se o token ainda tem mais de 24h de validade, reaproveita ele
    if (hoursToExpire > 24) return tokenData.access_token;
  }

  // Se não existe ou está expirando, solicita um novo token à Tray
  const payload = new URLSearchParams({
    consumer_key: process.env.TRAY_CONSUMER_KEY,
    consumer_secret: process.env.TRAY_CONSUMER_SECRET,
    code: process.env.TRAY_AUTH_CODE
  });

  // Faz requisição para gerar o token
  const response = await axios.post(
    'https://www.partsbarao.com.br/web_api/auth',
    payload.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  // Salva o token retornado em disco
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(response.data, null, 2));

  // Retorna o access_token para uso nas próximas chamadas
  return response.data.access_token;
}

// 🔹 Busca produto na Tray usando a "reference" (CódigoItemParcial da Linx)
export async function getTrayProductByReference(reference, token) {
  try {
    // Faz a requisição para a Tray filtrando pelo reference
    const response = await axios.get(
      `https://www.partsbarao.com.br/web_api/products/?access_token=${token}&reference=${reference}`
    );

    // Se encontrou produtos, pega o primeiro e retorna apenas os dados necessários
    if (response.data.Products && response.data.Products.length > 0) {
      const product = response.data.Products[0].Product;
      return {
        id: product.id,
        reference: product.reference,
        stock: parseInt(product.stock || 0) // Converte estoque para número
      };
    }

    // Se não encontrou, retorna null
    return null;
  } catch (err) {
    // Se houver erro, mostra no console
    console.error(`❌ Erro ao buscar produto com reference ${reference}:`, err.message);
    if (err.response) console.error('📦 Response da API:', err.response.data);
    return null;
  }
}

// 🔹 Atualiza o estoque de um produto na Tray usando o ID
export async function updateTrayStock(productId, newStock, token) {
  try {
    // Requisição PUT para atualizar o estoque
    const response = await axios.put(
      `https://www.partsbarao.com.br/web_api/products/${productId}?access_token=${token}`,
      { Product: { stock: newStock } }, // Atualiza apenas estoque
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Se a resposta contém ID do produto, considera sucesso
    if (response.data && response.data.id) return true;
    return false;
  } catch (err) {
    // Caso erro na atualização
    console.error(`❌ Erro ao atualizar estoque do produto ${productId}:`, err.message);
    if (err.response) console.error('📦 Response da API:', err.response.data);
    return false;
  }
}

// 🔹 Atualiza estoques em lotes de até 10 produtos por vez
export async function updateTrayProductsBatch(products) {
  const token = await getTrayToken(); // Garante token válido

  // Contadores de estatísticas finais
  let encontrados = 0;
  let naoEncontrados = 0;
  let semReferencia = 0;
  let errosAtualizacao = 0;

  // Array para detalhar o resultado por produto
  const resumoProdutos = [];

  // Processa os produtos em lotes de 10
  for (let i = 0; i < products.length; i += 10) {
    const batch = products.slice(i, i + 10);
    console.log(`\n🔹 Processando lote ${i / 10 + 1} de ${Math.ceil(products.length / 10)} (até 10 produtos)`);

    // Itera produto a produto dentro do lote
    for (const item of batch) {
      const trayReference = item.ItemEstoque; // Código de referência usado na Tray
      const newStock = item.CodigoEstoque || 0; // Novo estoque vindo da Linx

      // Caso não tenha referência, não consegue atualizar
      if (!trayReference) {
        console.warn(`❌ Produto sem referência válida, estoque: ${newStock}`);
        semReferencia++;
        continue;
      }

      // Busca o produto na Tray
      const product = await getTrayProductByReference(trayReference, token);

      // Se não encontrou o produto
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

      // Tenta atualizar o estoque na Tray
      const updated = await updateTrayStock(product.id, newStock, token);

      // Guarda resumo do resultado
      resumoProdutos.push({
        reference: trayReference,
        idTray: product.id,
        oldStock: product.stock,
        newStock,
        status: updated ? 'Atualizado' : 'Erro ao atualizar'
      });

      // Atualiza contadores de estatísticas
      if (updated) encontrados++;
      else errosAtualizacao++;
    }
  }

  // Exibe resumo detalhado de cada produto processado
  console.log(`\n📊 Resumo detalhado por produto:`);
  resumoProdutos.forEach(p => {
    console.log(`${p.status} | Reference Linx: ${p.reference} | ID Tray: ${p.idTray} | Estoque antigo: ${p.oldStock} | Novo estoque: ${p.newStock}`);
  });

  // Exibe estatísticas finais gerais
  console.log(`\n📊 Estatísticas finais:`);
  console.log(`✅ Produtos encontrados e atualizados: ${encontrados}`);
  console.log(`⚠️ Produtos não encontrados: ${naoEncontrados}`);
  console.log(`❌ Produtos sem referência: ${semReferencia}`);
  console.log(`❌ Produtos com erro ao atualizar: ${errosAtualizacao}`);
}
