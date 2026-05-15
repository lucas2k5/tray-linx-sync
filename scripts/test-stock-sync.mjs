import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const TRAY_STORE_URL = process.env.TRAY_STORE_URL;
const LINX_API_URL = process.env.LINX_API_URL;
const LINX_SUBSCRIPTION_KEY = process.env.LINX_SUBSCRIPTION_KEY;
const LINX_AMBIENTE = process.env.LINX_AMBIENTE;
const TRAY_CONSUMER_KEY = process.env.TRAY_CONSUMER_KEY;
const TRAY_CONSUMER_SECRET = process.env.TRAY_CONSUMER_SECRET;
const TRAY_AUTH_CODE = process.env.TRAY_AUTH_CODE;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STORE_ID = 'partsbarao';
const MIN_HOURS_REMAINING = 24;

// 1. Busca token (reusa ou renova via refresh_token)
async function getTrayToken() {
  const { data: row } = await supabase
    .from('tray_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('store_id', STORE_ID)
    .single();

  if (row) {
    const hoursRemaining = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
    if (hoursRemaining > MIN_HOURS_REMAINING) {
      console.log(`   Token reutilizado do Supabase (${hoursRemaining.toFixed(1)}h restantes)`);
      return row.access_token;
    }
    console.log(`   Token com ${hoursRemaining.toFixed(1)}h restantes — renovando...`);
  }

  const params = new URLSearchParams({
    consumer_key: TRAY_CONSUMER_KEY,
    consumer_secret: TRAY_CONSUMER_SECRET,
    code: TRAY_AUTH_CODE,
  });

  const resp = await axios.post(`${TRAY_STORE_URL}/web_api/auth`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokenData = resp.data;
  await supabase.from('tray_tokens').upsert({
    store_id: STORE_ID,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    expires_at: tokenData.date_expiration_access_token,
    api_host: tokenData.api_host ?? TRAY_STORE_URL,
    raw_response: tokenData,
  }, { onConflict: 'store_id' });

  console.log('   Token renovado e salvo no Supabase');
  return tokenData.access_token;
}

// 2. Busca 2 produtos da Linx
async function fetchTwoFromLinx() {
  const resp = await axios.post(
    `${LINX_API_URL}/api-e-commerce-premium/ConsultaPecaGerencial`,
    {
      ConfiguracaoBase: { Empresa: 1, Revenda: 1, Usuario: 0, CodigoOrigem: 0, IdentificadorOrigem: '', ClienteContactado: false },
      TextoPesquisa: '', CodigoItemParcial: '', CodigoEanGtin: '', DescricaoItemParcial: '',
      UtilizacaoItemParcial: '', GruposPecas: '', Marcas: '', ListaFornecedoresDSH: '',
      TipoPesquisa: 'I', ClasseFabrica: '', TipoTransacao: 'P21',
      RetiraPrecoMarkup: false, RecallFCA: false, DisponibilidadeCatalogo: false,
      Movimentados: false, Consultados: true, SomenteDisponiveis: true,
      PoliticaPreco: { CodigoPolitica: 0, PercentualSobrePrecoPublico: 0, PercentualSobrePrecoGarantia: 0, DescricaoPoliticaPreco: '' },
      CodigoReferenciaFabrica: '',
    },
    {
      headers: {
        'Content-Type': 'application/json-patch+json',
        'Cache-Control': 'no-cache',
        'Ocp-Apim-Subscription-Key': LINX_SUBSCRIPTION_KEY,
        Ambiente: LINX_AMBIENTE,
        Authorization: '',
      },
    }
  );

  return resp.data
    .filter((item) => item.ItemEstoque)
    .slice(0, 2)
    .map((item) => ({
      reference: item.ItemEstoque,
      stock: item.QuantidadeDisponivel ?? 0,
      description: item.DescricaoItem ?? '',
    }));
}

// 3. Busca produto na Tray pela referência
async function getTrayProductByReference(reference, token) {
  const resp = await axios.get(`${TRAY_STORE_URL}/web_api/products/`, {
    params: { access_token: token, reference },
  });
  const products = resp.data.Products;
  if (!products || products.length === 0) return null;
  const p = products[0].Product;
  return { id: p.id, reference: p.reference, stock: parseInt(p.stock ?? 0) };
}

// 4. Atualiza estoque na Tray
async function updateTrayStock(productId, newStock, token) {
  const resp = await axios.put(
    `${TRAY_STORE_URL}/web_api/products/${productId}`,
    { Product: { stock: newStock } },
    { headers: { 'Content-Type': 'application/json' }, params: { access_token: token } }
  );
  return resp.data;
}

// --- main ---
(async () => {
  console.log('=== Teste de sync de estoque (2 produtos) ===\n');

  console.log('1. Obtendo token Tray...');
  const token = await getTrayToken();
  console.log(`   Token: ${token.substring(0, 50)}...\n`);

  console.log('2. Buscando 2 produtos na Linx...');
  const linxItems = await fetchTwoFromLinx();
  console.log(`   Encontrados: ${linxItems.length} produtos`);
  linxItems.forEach((item, i) => {
    console.log(`   [${i + 1}] ref=${item.reference} | estoque=${item.stock} | desc="${item.description}"`);
  });
  console.log();

  for (const item of linxItems) {
    console.log(`3. Buscando "${item.reference}" na Tray...`);
    const trayProduct = await getTrayProductByReference(item.reference, token).catch(() => null);

    if (!trayProduct) {
      console.log(`   ❌ Produto "${item.reference}" não encontrado na Tray\n`);
      continue;
    }

    console.log(`   Encontrado: ID=${trayProduct.id}, estoque atual=${trayProduct.stock}`);
    console.log(`   Atualizando para estoque=${item.stock}...`);

    const result = await updateTrayStock(trayProduct.id, item.stock, token);
    console.log(`   ✅ Atualizado! Resposta: ${JSON.stringify(result)}\n`);
  }

  console.log('=== Fim do teste ===');
})().catch((err) => {
  console.error('ERRO:', err.response?.data ?? err.message);
  process.exit(1);
});
