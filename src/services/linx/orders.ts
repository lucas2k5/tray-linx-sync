import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import type {
  LinxClienteResult,
  LinxClienteResponse,
  LinxInserirContatoResponse,
  LinxInserirItemResponse,
  LinxOrderPayload,
} from '../../types/linx.js';
import type { TrayOrderComplete, TrayCustomer, TrayOrderItem } from '../../types/tray.js';

const LINX_ENDPOINT = `${env.LINX_API_URL}/api-e-commerce-premium`;

const LINX_HEADERS = {
  'Content-Type': 'application/json-patch+json',
  'Cache-Control': 'no-cache',
  'Ocp-Apim-Subscription-Key': env.LINX_SUBSCRIPTION_KEY,
  Ambiente: env.LINX_AMBIENTE,
  Authorization: '',
};

const CONFIG_ORIGEM = {
  Empresa: 1,
  Revenda: 1,
  Usuario: 0,
  CodigoOrigem: 0,
  IdentificadorOrigem: '',
};

// ─── Passo 1: Busca cliente na Linx pelo CPF/CNPJ ────────────────────────────
async function buscarClienteLinx(cpfCnpj: string): Promise<LinxClienteResult | null> {
  const digits = cpfCnpj.replace(/\D/g, '');
  const isCnpj = digits.length > 11;

  const body = {
    Empresa: CONFIG_ORIGEM.Empresa,
    Revenda: CONFIG_ORIGEM.Revenda,
    Usuario: CONFIG_ORIGEM.Usuario,
    ValidaRg: false,
    TipoCliente: isCnpj ? 2 : 1,
    CnpjCPF: digits,
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

  const response = await axios.post<LinxClienteResponse>(
    `${LINX_ENDPOINT}/Geral/ConsultaClientes/ConsultaClientesPaginado`,
    body,
    { headers: LINX_HEADERS }
  );

  const clientes = response.data?.Clientes ?? (response.data as unknown as LinxClienteResult[]);
  if (!Array.isArray(clientes) || clientes.length === 0) return null;

  return clientes[0] ?? null;
}

// ─── Passo 2: Cria atendimento na Linx ───────────────────────────────────────
async function inserirContato(
  clienteLinx: LinxClienteResult | null,
  trayOrder: TrayOrderComplete
): Promise<number> {
  const orderId = trayOrder.Order?.id ?? 'unknown';

  const body = {
    configuracaoOrigem: {
      ...CONFIG_ORIGEM,
      IdentificadorOrigem: `TRAY-${orderId}`,
    },
    // TODO: confirmar payload exato com a Linx — a collection Postman tem body
    // incorreto neste endpoint (cópia de ConsultaPecaGerencial). Ajustar quando
    // a Linx fornecer a estrutura correta.
    Contato: clienteLinx?.Codigo ?? clienteLinx?.CodigoCliente ?? 0,
    TipoTransacao: 'P21',
    PedidoOrigem: `TRAY-${orderId}`,
  };

  const response = await axios.post<LinxInserirContatoResponse>(
    `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirContato`,
    body,
    { headers: LINX_HEADERS }
  );

  const data = response.data as Record<string, unknown>;
  const contatoId = data['Contato'] ?? data['NumeroContato'] ?? data['Id'];

  if (!contatoId) {
    throw new Error('InserirContato não retornou um ID de atendimento válido');
  }

  return Number(contatoId);
}

// ─── Passo 3: Insere um item no atendimento ───────────────────────────────────
async function inserirItem(
  contatoId: number,
  item: { ItemEstoque: number; Quantidade: number; ValorUnitario: number; Desconto: number }
): Promise<LinxInserirItemResponse> {
  const body = {
    dadosDoItem: {
      ItemEstoque: item.ItemEstoque,
      Quantidade: item.Quantidade,
      ValorUnitario: item.ValorUnitario,
      Desconto: item.Desconto,
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
      configuracaoOrigem: CONFIG_ORIGEM,
      parametrosSelecao: {
        Empresa: CONFIG_ORIGEM.Empresa,
        Revenda: CONFIG_ORIGEM.Revenda,
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

  const response = await axios.post<LinxInserirItemResponse>(
    `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirItem`,
    body,
    { headers: LINX_HEADERS }
  );

  return response.data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extrairDocumento(customer: TrayCustomer | undefined): string {
  if (!customer) return '';
  return customer.cpf ?? customer.cnpj ?? customer.CpfCnpj ?? customer.documento ?? '';
}

function mapTrayItemsToLinx(
  productsSold: TrayOrderItem[] | undefined
): Array<{ ItemEstoque: number; Quantidade: number; ValorUnitario: number; Desconto: number }> {
  if (!productsSold?.length) return [];

  return productsSold.map((entry) => {
    const item = entry.ProductsSold ?? entry;
    return {
      // TODO: validar se reference da Tray bate direto com ItemEstoque numérico
      // ou se precisa busca extra via ConsultaPecaGerencial
      ItemEstoque: parseInt(String(item.reference ?? item.id ?? 0)),
      Quantidade: parseFloat(String(item.quantity ?? item.Quantity ?? 1)),
      ValorUnitario: parseFloat(String(item.price ?? item.Price ?? 0)),
      Desconto: parseFloat(String(item.discount ?? 0)),
    };
  });
}

// ─── Orquestrador principal ───────────────────────────────────────────────────
export async function sendOrderToLinx(trayOrderData: TrayOrderComplete): Promise<LinxOrderPayload> {
  const orderId = `TRAY-${trayOrderData.Order?.id ?? 'unknown'}`;
  const log = logger.child({ orderId });

  log.info('Iniciando envio para Linx AutoShop');

  // Passo 1 — buscar cliente
  const documento = extrairDocumento(trayOrderData.Customer);
  let clienteLinx: LinxClienteResult | null = null;

  if (documento) {
    const masked = documento.slice(0, -3).replace(/\d/g, '*') + documento.slice(-3);
    log.info({ doc: masked }, 'Buscando cliente na Linx');
    try {
      clienteLinx = await buscarClienteLinx(documento);
      if (clienteLinx) {
        log.info({ codigo: clienteLinx.Codigo ?? clienteLinx.CodigoCliente }, 'Cliente encontrado na Linx');
      } else {
        log.warn('Cliente não encontrado na Linx, continuando sem vínculo');
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Erro ao buscar cliente na Linx');
    }
  } else {
    log.warn('Pedido sem CPF/CNPJ no payload Tray');
  }

  // Passo 2 — criar atendimento
  const contatoId = await inserirContato(clienteLinx, trayOrderData);
  log.info({ contatoId }, 'Atendimento criado na Linx');

  // Passo 3 — inserir itens
  const itens = mapTrayItemsToLinx(trayOrderData.ProductsSold);
  log.info({ count: itens.length }, 'Inserindo itens no atendimento');

  for (const item of itens) {
    try {
      await inserirItem(contatoId, item);
      log.info({ itemEstoque: item.ItemEstoque, qtd: item.Quantidade }, 'Item inserido');
    } catch (err: unknown) {
      log.error(
        { itemEstoque: item.ItemEstoque, err: err instanceof Error ? err.message : String(err) },
        'Falha ao inserir item'
      );
    }
  }

  log.info({ contatoId }, 'Pedido enviado à Linx com sucesso');

  return { pedidoOrigem: orderId, raw: trayOrderData };
}
