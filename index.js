require('dotenv').config();
const express = require('express');
const app = express();
const syncStock = require('./jobs/syncStock');

app.get('/', (req, res) => {
  res.send('API de Sincronização Tray ↔ Linx');
});

app.listen(process.env.PORT, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT}`);
  syncStock();
});

