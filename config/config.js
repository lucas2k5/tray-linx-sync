// config/config.js
const axios = require('axios');
const trayConfig = require('./tray');

let trayToken = null;
let tokenExpiration = null;

/**
 * Retorna o token da Tray.
 * Se já existe em cache e não expirou, retorna o mesmo.
 * Se não existe ou expirou, gera um novo.
 */
async function getTrayToken() {
  const now = Date.now();

  // Se o token ainda é válido, retorna ele
  if (trayToken && tokenExpiration && now < tokenExpiration) {
    return trayToken;
  }

  console.log('🔑 Gerando novo token da Tray...');

  try {
    const response = await axios.post(`${trayConfig.baseUrl}/auth`, {
      consumer_key: trayConfig.consumerKey,
      consumer_secret: trayConfig.consumerSecret,
      store_url: trayConfig.storeUrl,
      callback_url: trayConfig.callbackUrl,
    });

    trayToken = response.data.access_token;

    // Expira em 30 dias (vamos marcar 29 dias para garantir a renovação antes)
    const expiresInMs = 1000 * 60 * 60 * 24 * 29;
    tokenExpiration = now + expiresInMs;

    console.log('✅ Novo token Tray gerado com sucesso.');
    return trayToken;
  } catch (error) {
    console.error('❌ Erro ao gerar token da Tray:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  getTrayToken,
};
