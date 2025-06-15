const axios = require('axios');
const { baseUrl, consumerKey, consumerSecret } = require('../config/tray');

async function getAccessToken(code) {
  const url = `${baseUrl}/auth/token`;
  const response = await axios.post(url, {
    grant_type: 'authorization_code',
    code,
    consumer_key: consumerKey,
    consumer_secret: consumerSecret,
    redirect_uri: process.env.TRAY_REDIRECT_URI,
  });
  return response.data.access_token;
}

async function updateStock(productId, quantity, accessToken) {
  const url = `${baseUrl}/products/${productId}`;
  const response = await axios.put(
    url,
    { available: quantity },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  return response.data;
}

module.exports = {
  getAccessToken,
  updateStock,
};

