const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.resolve(__dirname, '../tray-token.json');

async function getTrayToken() {
  const tokenExists = fs.existsSync(TOKEN_PATH);

  if (tokenExists) {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const expires = new Date(tokenData.date_expiration_access_token);
    const now = new Date();

    const hoursToExpire = (expires - now) / (1000 * 60 * 60);
    if (hoursToExpire > 24) return tokenData.access_token; // ainda é válido
  }

  // Gera novo token
  const payload = new URLSearchParams({
    consumer_key: process.env.TRAY_CONSUMER_KEY,
    consumer_secret: process.env.TRAY_CONSUMER_SECRET,
    code: process.env.TRAY_AUTH_CODE
  });

  const response = await axios.post('https://1225878.commercesuite.com.br/web_api/auth', payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(response.data, null, 2));
  return response.data.access_token;
}

async function getTrayProduct(productId, token) {
  try {
    const response = await axios.get(`https://1225878.commercesuite.com.br/web_api/products/${productId}?access_token=${token}`);
    return response.data;
  } catch (err) {
    console.error(`❌ Erro ao buscar produto ${productId} na Tray:`, err.message);
    return null;
  }
}

async function updateTrayStock(productId, newStock, token) {
  try {
    const response = await axios.put(
      `https://1225878.commercesuite.com.br/web_api/products/${productId}?access_token=${token}`,
      {
        Product: {
          stock: newStock
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log(`✅ Estoque do produto ${productId} atualizado para ${newStock}`);
    return response.data;
  } catch (err) {
    console.error(`❌ Erro ao atualizar estoque do produto ${productId}:`, err.message);
    return null;
  }
}

module.exports = {
  getTrayToken,
  getTrayProduct,
  updateTrayStock
};
