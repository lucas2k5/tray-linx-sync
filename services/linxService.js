const axios = require('axios');

async function fetchStockFromLinx() {
  const response = await axios.get(`${process.env.LINX_API_URL}`);
  return response.data;
}

module.exports = {
  fetchStockFromLinx,
};

