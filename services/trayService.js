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
      return response.data.Products[0];
    }

    console.warn(`⚠️ Nenhum produto encontrado na Tray com reference ${reference}`);
    return null;
  } catch (err) {
    console.error(`❌ Erro ao buscar produto com reference ${reference}:`, err.message);
    if (err.response) {
      console.error('📦 Response da API:', err.response.data);
    }
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

    console.log(`✅ Estoque do produto ${productId} atualizado para ${newStock}`);
    return response.data;
  } catch (err) {
    console.error(`❌ Erro ao atualizar estoque do produto ${productId}:`, err.message);
    if (err.response) {
      console.error('📦 Response da API:', err.response.data);
    }
    return null;
  }
}
