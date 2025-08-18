const axios = require('axios'); // Biblioteca para fazer requisições HTTP
const fs = require('fs');       // Para manipulação de arquivos (salvar/ler token)
const path = require('path');   // Para trabalhar com caminhos de arquivos

// Caminho absoluto para armazenar o token da Tray em disco
const TOKEN_PATH = path.resolve(__dirname, '../tray-token.json');

/**
 * Recupera o token da Tray (se já existir e ainda for válido),
 * ou gera um novo caso não exista ou esteja prestes a expirar.
 */
async function getTrayToken() {
  const tokenExists = fs.existsSync(TOKEN_PATH);

  if (tokenExists) {
    // Lê o token salvo no arquivo
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const expires = new Date(tokenData.date_expiration_access_token);
    const now = new Date();

    // Calcula quantas horas faltam para expirar
    const hoursToExpire = (expires - now) / (1000 * 60 * 60);

    // Se ainda faltar mais de 24h, retorna o token salvo
    if (hoursToExpire > 24) return tokenData.access_token;
  }

  // Caso contrário, solicita novo token para a Tray
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

  // Salva o novo token no disco
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(response.data, null, 2));

  return response.data.access_token;
}

/**
 * Busca produto na Tray usando o `reference` (CódigoItemParcial da Linx).
 * Retorna o objeto do produto encontrado ou `null` se não achar.
 */
async function getTrayProductByReference(reference, token) {
  try {
    const response = await axios.get(
      `https://www.partsbarao.com.br/web_api/products/?access_token=${token}&reference=${reference}`
    );

    // A API retorna uma lista de produtos (Products)
    if (response.data.Products && response.data.Products.length > 0) {
      return response.data.Products[0]; // Pega o primeiro produto da lista
    }

    console.warn(`⚠️ Nenhum produto encontrado na Tray com reference ${reference}`);
    return null;
  } catch (err) {
    console.error(`❌ Erro ao buscar produto com reference ${reference}:`, err.message);
    return null;
  }
}

/**
 * Atualiza o estoque de um produto na Tray.
 * Para isso, usa o `id` retornado pelo getTrayProductByReference.
 */
async function updateTrayStock(productId, newStock, token) {
  try {
    const response = await axios.put(
      `https://www.partsbarao.com.br/web_api/products/${productId}?access_token=${token}`,
      {
        Product: {
          stock: newStock // Atualiza apenas o campo de estoque
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Estoque do produto ${productId} atualizado para ${newStock}`);
    return response.data;
  } catch (err) {
    console.error(`❌ Erro ao atualizar estoque do produto ${productId}:`, err.message);
    return null;
  }
}

// Exporta as funções para outros módulos
module.exports = {
  getTrayToken,
  getTrayProductByReference,
  updateTrayStock
};
