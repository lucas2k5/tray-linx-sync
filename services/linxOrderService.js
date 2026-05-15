import axios from 'axios';

const LINX_BASE = process.env.LINX_API_URL || 'https://auto-gwsmartapi.linx.com.br';
const LINX_ENDPOINT = `${LINX_BASE}/api-e-commerce-premium`;

const LINX_HEADERS = {
  'Content-Type': 'application/json-patch+json',
  'Cache-Control': 'no-cache',
  'Ocp-Apim-Subscription-Key': process.env.LINX_SUBSCRIPTION_KEY,
  Ambiente: process.env.LINX_AMBIENTE,
  Authorization: '',
};

const CONFIG_BASE = {
  Empresa: 1,
  Revenda: 1,
  Usuario: 0,
  CodigoOrigem: 0,
  IdentificadorOrigem: '',
  ClienteContactado: false,
};

// ─── Passo 1: Busca o cliente na Linx pelo CPF ou CNPJ ───────────────────────
async function buscarClienteLinx(cpfCnpj) {
  const isCnpj = cpfCnpj.replace(/\D/g, '').length > 11;

  const body = {
    Empresa: CONFIG_BASE.Empresa,
    Revenda: CONFIG_BASE.Revenda,
    Usuario: CONFIG_BASE.Usuario,
    ValidaRg: false,
    TipoCliente: isCnpj ? 2 : 1, // 1 = PF, 2 = PJ
    CnpjCPF: cpfCnpj.replace(/\D/g, ''),
    Rg: '',
    Nome: '',
    Fantasia: '',
    Cidade: '',
    UF: '',
    Cep: 0,
    Ddd: 0,
    Telefone: 0,
    Categoria: '',
    NascidoEntre: false,
    NascidoEntreChecked: false,
    NascidoInicial: '',
    NascidoFinal: '',
    TipoClassificacao: 0,
    ConsultaLGPD: false,
  };

  const response = await axios.post(
    `${LINX_ENDPOINT}/Geral/ConsultaClientes/ConsultaClientesPaginado`,
    body,
    { headers: LINX_HEADERS }
  );

  const clientes = response.data?.Clientes || response.data;
  if (!Array.isArray(clientes) || clientes.length === 0) return null;

  return clientes[0];
}

// ─── Passo 2: Cria o atendimento (pedido) na Linx ────────────────────────────
// Retorna o número do Contato (ID do atendimento) para uso no InserirItem
async function inserirContato(clienteLinx, trayOrder) {
  const order = trayOrder.Order || trayOrder;

  const body = {
    configuracaoOrigem: {
      Empresa: CONFIG_BASE.Empresa,
      Revenda: CONFIG_BASE.Revenda,
      Usuario: CONFIG_BASE.Usuario,
      CodigoOrigem: 0,
      IdentificadorOrigem: `TRAY-${order.id}`,
    },
    // TODO: confirmar campos exatos com a Linx — o body do InserirContato
    // não está documentado corretamente na collection (ela tem o body de
    // ConsultaPecaGerencial por engano). Os campos abaixo são uma estimativa
    // baseada no padrão da API AtendimentoBalcao.
    Contato: clienteLinx?.Codigo || clienteLinx?.CodigoCliente || 0,
    TipoTransacao: 'P21',
    PedidoOrigem: `TRAY-${order.id}`,
  };

  const response = await axios.post(
    `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirContato`,
    body,
    { headers: LINX_HEADERS }
  );

  // O campo exato que retorna o ID do atendimento pode variar — ajustar após
  // validar a resposta real da API
  const contatoId =
    response.data?.Contato ||
    response.data?.NumeroContato ||
    response.data?.Id ||
    response.data;

  if (!contatoId) throw new Error('InserirContato não retornou um ID de atendimento válido');
  return contatoId;
}

// ─── Passo 3: Adiciona um item ao atendimento ─────────────────────────────────
async function inserirItem(contatoId, item) {
  const body = {
    dadosDoItem: {
      ItemEstoque: item.ItemEstoque || 0,
      Quantidade: item.Quantidade,
      ValorUnitario: item.ValorUnitario,
      Desconto: item.Desconto || 0,
      DescontoLinxPromo: 0,
      DescontoUnitarioLinxPromo: 0,
      ContadorItem: 0,
      CodigoItemPedidoCompra: 0,
      OrdemCompraCliente: '',
      NroSolicitacao: 0,
      Kit: 0,
      KitEditavel: '',
      PermitirItemCoringa: false,
      ItemCoringa: '',
      Aprovacao: 0,
      IndTot: true,
      Gratuidade: 0,
    },
    dadosOrigem: {
      configuracaoOrigem: {
        Empresa: CONFIG_BASE.Empresa,
        Revenda: CONFIG_BASE.Revenda,
        Usuario: CONFIG_BASE.Usuario,
        CodigoOrigem: 0,
        IdentificadorOrigem: '',
      },
      parametrosSelecao: {
        Empresa: CONFIG_BASE.Empresa,
        Revenda: CONFIG_BASE.Revenda,
        Contato: contatoId,
        Solicitacao: 0,
        OrdemServico: 0,
        OrdemCompra: 0,
        CodigoKit: 0,
        CodigoServico: 0,
        Pedido: '',
        Promocao: 0,
        Cotacao: 0,
        NumeroNotaFiscal: 0,
        SerieNotaFiscal: '',
        TipoTransacao: 'P21',
        Contador: 0,
      },
    },
    detalhesDesconto: {
      descontoPercentual: 0,
      descontoPercentualLinxPromo: 0,
      descontoPercentualTotal: 0,
      valorTotal: item.ValorUnitario * item.Quantidade,
      rentabilidadePercentual: 0,
      custoUnitario: 0,
      impostos: {
        Ipi: { Valor: 0, Aliquota: 0, Base: 0 },
        PisCofins: { Valor: 0, Aliquota: 0, Base: 0 },
        IcmsRetido: { Valor: 0, Aliquota: 0, Base: 0 },
        Icms: { Valor: 0, Aliquota: 0, Base: 0 },
        ValorIcmsComoDesconto: 0,
        ValorIcmsOperacaoPropria: 0,
        ValorImpostoGlobal: 0,
        criterioBaseIPI: 0,
      },
    },
    exibirDescontoEValor: true,
    exibeRentabilidade: false,
    permiteEditarValorDesconto: false,
    exibirOrdemDeCompra: false,
    ExibirValores: true,
    HabilitaQuantidade: true,
    valorizacao: '',
    contato: contatoId,
    PoliticaDePreco: 0,
    QuantidadeInteira: true,
    ValorUnitarioInicial: item.ValorUnitario,
    Mecanico: 0,
  };

  const response = await axios.post(
    `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirItem`,
    body,
    { headers: LINX_HEADERS }
  );

  return response.data;
}

// ─── Transforma ProductsSold da Tray para o formato do InserirItem ───────────
function mapTrayItemsToLinx(productsSold) {
  const items = Array.isArray(productsSold) ? productsSold : [];
  return items.map((entry) => {
    const item = entry.ProductsSold || entry;
    return {
      // reference da Tray = ItemEstoque público da Linx (ex: "0290.01234")
      // ItemEstoque numérico interno da Linx precisa ser buscado via ConsultaPecaGerencial
      // TODO: validar se o reference da Tray bate com ItemEstoque ou com CodigoItemParcial
      ItemEstoque: parseInt(item.reference || item.id || 0),
      Quantidade: parseFloat(item.quantity || item.Quantity || 1),
      ValorUnitario: parseFloat(item.price || item.Price || 0),
      Desconto: parseFloat(item.discount || 0),
    };
  });
}

// ─── Extrai CPF/CNPJ do cliente Tray ─────────────────────────────────────────
function extrairDocumento(trayOrder) {
  const customer = trayOrder.Customer || trayOrder.customer || {};
  return (
    customer.cpf ||
    customer.cnpj ||
    customer.CpfCnpj ||
    customer.documento ||
    ''
  );
}

// ─── Orquestrador principal ───────────────────────────────────────────────────
export async function sendOrderToLinx(trayOrderData) {
  const order = trayOrderData.Order || trayOrderData;
  const orderId = `TRAY-${order.id}`;

  console.log(`📤 Iniciando envio do pedido ${orderId} para Linx AutoShop...`);

  // Passo 1 — buscar cliente
  const documento = extrairDocumento(trayOrderData);
  let clienteLinx = null;

  if (documento) {
    console.log(`🔍 Buscando cliente na Linx (doc: ${documento.replace(/\d/g, '*').slice(0, -3) + documento.slice(-3)})...`);
    try {
      clienteLinx = await buscarClienteLinx(documento);
      if (clienteLinx) {
        console.log(`✅ Cliente encontrado na Linx (código: ${clienteLinx.Codigo || clienteLinx.CodigoCliente})`);
      } else {
        console.warn(`⚠️ Cliente não encontrado na Linx para o documento informado.`);
      }
    } catch (err) {
      console.warn(`⚠️ Erro ao buscar cliente na Linx: ${err.message} — continuando sem vínculo de cliente.`);
    }
  } else {
    console.warn(`⚠️ Pedido ${orderId} sem CPF/CNPJ no payload da Tray.`);
  }

  // Passo 2 — criar atendimento
  let contatoId;
  try {
    contatoId = await inserirContato(clienteLinx, trayOrderData);
    console.log(`✅ Atendimento criado na Linx (Contato ID: ${contatoId})`);
  } catch (err) {
    console.error(`❌ Falha ao criar atendimento na Linx para pedido ${orderId}:`, err.message);
    if (err.response) console.error('📦 Response Linx:', JSON.stringify(err.response.data));
    throw err;
  }

  // Passo 3 — inserir itens
  const productsSold = trayOrderData.ProductsSold || trayOrderData.products || [];
  const itensLinx = mapTrayItemsToLinx(productsSold);
  console.log(`📦 Inserindo ${itensLinx.length} item(ns) no atendimento ${contatoId}...`);

  const resultados = [];
  for (const item of itensLinx) {
    try {
      const res = await inserirItem(contatoId, item);
      console.log(`  ✅ Item ${item.ItemEstoque} (qtd: ${item.Quantidade}) inserido.`);
      resultados.push({ item, ok: true, res });
    } catch (err) {
      console.error(`  ❌ Falha ao inserir item ${item.ItemEstoque}:`, err.message);
      if (err.response) console.error('  📦 Response Linx:', JSON.stringify(err.response.data));
      resultados.push({ item, ok: false, erro: err.message });
    }
  }

  const falhas = resultados.filter((r) => !r.ok);
  if (falhas.length > 0) {
    console.warn(`⚠️ Pedido ${orderId} inserido com ${falhas.length} item(ns) com falha.`);
  } else {
    console.log(`✅ Pedido ${orderId} enviado à Linx com sucesso. Contato: ${contatoId}`);
  }

  return { orderId, contatoId, itens: resultados };
}
