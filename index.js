require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const syncStock = require('./jobs/syncStock');
const { fetchStockFromLinx } = require('./services/linxService');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('API de sincronização ativa'));

app.get('/simulate-linx', async (req, res) => {
  const data = await fetchStockFromLinx();
  res.json(data);
});

// Executa diariamente às 01:00 (horário de Brasília)
cron.schedule('0 1 * * *', () => {
  console.log('⏰ Rodando sincronização diária às 01:00 (America/Sao_Paulo)...');
  syncStock();
}, {
  timezone: 'America/Sao_Paulo'
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
