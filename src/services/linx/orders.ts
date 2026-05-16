import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { buscarCodigoEstoque } from './stock.js';
import type {
  LinxCadastrarClienteResponse,
  LinxOrderPayload,
} from '../../types/linx.js';
import type { TrayOrderComplete, TrayCustomer } from '../../types/tray.js';

const LINX_ENDPOINT = `${env.LINX_API_URL}/api-e-commerce-premium`;

const LINX_HEADERS = {
  'Content-Type': 'application/json-patch+json',
  'Cache-Control': 'no-cache',
  'Ocp-Apim-Subscription-Key': env.LINX_SUBSCRIPTION_KEY,
  Ambiente: env.LINX_AMBIENTE,
  Authorization: '',
};

// CodigoOrigem: 32 = Atendimento Balcão (0 causa erro na Linx)
const CONFIG_ORIGEM_ATENDIMENTO = {
  Empresa: 1,
  Revenda: 1,
  Usuario: 0,
  CodigoOrigem: 32,
  IdentificadorOrigem: '',
  ClienteContactado: true,
  NroSolicitacao: 0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function axiosErrorDetail(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: unknown; status?: number } }).response;
    return `HTTP ${res?.status} — ${JSON.stringify(res?.data)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function parseDDD(phone: string | undefined): number {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? parseInt(digits.substring(0, 2)) : 0;
}

function parseTelefone(phone: string | undefined): number {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length > 2 ? parseInt(digits.substring(2)) : 0;
}

function extrairDocumento(customer: TrayCustomer | undefined): string {
  if (!customer) return '';
  const cpf = (customer.cpf ?? '').replace(/\D/g, '');
  const cnpj = (customer.cnpj ?? '').replace(/\D/g, '');
  return cpf || cnpj;
}

// ─── Passo 1: Cadastrar cliente ───────────────────────────────────────────────
async function cadastrarCliente(customer: TrayCustomer): Promise<number> {
  const cpfCnpj = extrairDocumento(customer);
  const tipoPessoa = cpfCnpj.length > 11 ? 1 : 0;
  const cep = parseInt((customer.zip_code ?? '').replace(/\D/g, '') || '0');

  // Endereço: address + número concatenados (max 70 chars)
  const enderecoCompleto = [customer.address, customer.number]
    .filter(Boolean)
    .join(', ')
    .substring(0, 70);

  const body = {
    ObrigaCPFCNPJ: true,
    CPFCNPJ: cpfCnpj,
    CEP: cep,
    Cidade: (customer.city ?? '').substring(0, 50),
    UF: (customer.state ?? '').substring(0, 2),
    Nome: (customer.name ?? '').substring(0, 70),
    Celular: parseTelefone(customer.cellphone),
    VerificaTelefone: false,
    Telefone: parseTelefone(customer.phone),
    TipoPessoa: tipoPessoa,
    BPVCategoria: false,
    Categoria: 1,
    DDD: parseDDD(customer.phone),
    DDDCelular: parseDDD(customer.cellphone),
    EmailCasa: (customer.email ?? '').substring(0, 150),
    Endereco: enderecoCompleto,
    Complemento: (customer.complement ?? '').substring(0, 60),
    Bairro: (customer.neighborhood ?? '').substring(0, 50),
    OrigemCadastro: 'ECOMMERCE',
    Empresa: 1,
    Revenda: 1,
    Cliente: 0,
    ValidarCamposObrigatorios: false,
    Clifor: 'C',
    EnderecoCobranca: 1,
    CadastraCepAutomaticamente: true,
    NaoValidarCepCadastroAutomatico: true,
  };

  const response = await axios.post<LinxCadastrarClienteResponse>(
    `${LINX_ENDPOINT}/Geral/ManutencaoClienteSimplificado/CadastrarClienteSimplificado`,
    body,
    { headers: LINX_HEADERS }
  );

  const codigoCliente = response.data?.Cliente;
  if (!codigoCliente) {
    throw new Error(`CadastrarClienteSimplificado não retornou código de cliente. Response: ${JSON.stringify(response.data)}`);
  }

  return codigoCliente;
}

// ─── Passo 2: Abrir atendimento ───────────────────────────────────────────────
async function inserirContato(codigoCliente: number, orderId: string): Promise<number> {
  const body = {
    Cliente: codigoCliente,
    TipoTransacao: 'P21',
    Contato: 0,
    DadosContato: {
      FormaContato: 0,
      TipoContato: 0,
      SubTipoContato: 0,
      OrigemTrafego: 0,
    },
    Empresa: CONFIG_ORIGEM_ATENDIMENTO.Empresa,
    Revenda: CONFIG_ORIGEM_ATENDIMENTO.Revenda,
    Usuario: CONFIG_ORIGEM_ATENDIMENTO.Usuario,
    CodigoOrigem: CONFIG_ORIGEM_ATENDIMENTO.CodigoOrigem,
    IdentificadorOrigem: `TRAY-${orderId}`,
    ClienteContactado: true,
    NroSolicitacao: 0,
  };

  let response: Awaited<ReturnType<typeof axios.post<number>>>;
  try {
    response = await axios.post<number>(
      `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirContato`,
      body,
      { headers: LINX_HEADERS }
    );
  } catch (err: unknown) {
    throw new Error(`InserirContato falhou: ${axiosErrorDetail(err)}`);
  }

  // API retorna número inteiro direto (ex: 60833), não JSON
  const contatoId = Number(response.data);
  if (!contatoId || isNaN(contatoId)) {
    throw new Error(`InserirContato não retornou ID válido. Response: ${JSON.stringify(response.data)}`);
  }

  return contatoId;
}

// ─── Passo 3: Inserir item no atendimento ─────────────────────────────────────
async function inserirItem(
  contatoId: number,
  codigoEstoque: number,
  quantidade: number,
  valorUnitario: number
): Promise<void> {
  const body = {
    dadosDoItem: {
      ItemEstoque: codigoEstoque,
      Quantidade: quantidade,
      ValorUnitario: valorUnitario,
      Desconto: 0,
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
      configuracaoOrigem: CONFIG_ORIGEM_ATENDIMENTO,
      parametrosSelecao: {
        Empresa: CONFIG_ORIGEM_ATENDIMENTO.Empresa,
        Revenda: CONFIG_ORIGEM_ATENDIMENTO.Revenda,
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
      valorTotal: 0,
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
    ValorUnitarioInicial: valorUnitario,
    Mecanico: 0,
    ObterValorUnitario: false,
  };

  // Query params obrigatórios — sem eles retorna 412
  await axios.post(
    `${LINX_ENDPOINT}/Pecas/AtendimentoBalcao/Atendimento/InserirItem`,
    body,
    {
      headers: LINX_HEADERS,
      params: { tipoVenda: 'V', editadoNaSelPecaPai: 'false' },
    }
  );
}

// ─── Orquestrador principal ───────────────────────────────────────────────────
export async function sendOrderToLinx(trayOrderData: TrayOrderComplete): Promise<LinxOrderPayload> {
  const order = trayOrderData.Order;
  const orderId = order?.id ?? 'unknown';
  const log = logger.child({ orderId: `TRAY-${orderId}` });

  log.info('Iniciando envio para Linx AutoShop');

  const customer = order?.Customer;
  const documento = extrairDocumento(customer);

  if (!documento) {
    throw new Error('Pedido sem CPF/CNPJ — não é possível criar cliente na Linx');
  }

  // Passo 1 — cadastrar cliente
  const masked = documento.slice(0, -3).replace(/\d/g, '*') + documento.slice(-3);
  log.info({ doc: masked }, 'Cadastrando cliente na Linx');

  let codigoCliente: number;
  try {
    codigoCliente = await cadastrarCliente(customer!);
    log.info({ codigoCliente }, 'Cliente cadastrado na Linx');
  } catch (err: unknown) {
    // Duplicata de CPF: a Linx retorna erro mas o cliente existe — relançar para retry
    throw new Error(`Erro ao cadastrar cliente: ${axiosErrorDetail(err)}`);
  }

  // Passo 2 — abrir atendimento
  const contatoId = await inserirContato(codigoCliente, orderId);
  log.info({ contatoId }, 'Atendimento aberto na Linx');

  // Passo 3 — inserir itens
  const produtos = order?.ProductsSold ?? [];
  log.info({ count: produtos.length }, 'Inserindo itens no atendimento');

  let itensInseridos = 0;
  let itensFalhados = 0;
  const itens: import('../../types/linx.js').LinxItemDetalhe[] = [];

  for (const wrapper of produtos) {
    const item = wrapper.ProductsSold;
    const reference = item?.reference;
    const quantidade = parseFloat(item?.quantity ?? '1');
    const valorUnitario = parseFloat(item?.price ?? '0');

    if (!reference) {
      log.warn('Item sem reference — ignorado');
      itensFalhados++;
      itens.push({ reference: '(sem reference)', codigoEstoque: null, quantidade, status: 'sem_reference' });
      continue;
    }

    // Busca CodigoEstoque numérico via ConsultaPecaGerencial
    log.debug({ reference }, 'Buscando CodigoEstoque na Linx');
    const codigoEstoque = await buscarCodigoEstoque(reference);

    if (!codigoEstoque) {
      log.warn({ reference }, 'CodigoEstoque não encontrado na Linx — item ignorado');
      itensFalhados++;
      itens.push({ reference, codigoEstoque: null, quantidade, status: 'sem_codigo' });
      continue;
    }

    try {
      await inserirItem(contatoId, codigoEstoque, quantidade, valorUnitario);
      log.info({ reference, codigoEstoque, quantidade, valorUnitario }, 'Item inserido com sucesso');
      itensInseridos++;
      itens.push({ reference, codigoEstoque, quantidade, status: 'inserido' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : axiosErrorDetail(err);
      log.error({ reference, codigoEstoque, err: msg }, 'Falha ao inserir item');
      itensFalhados++;
      itens.push({ reference, codigoEstoque, quantidade, status: 'falhou', erro: msg });
    }
  }

  log.info({ contatoId, itensInseridos, itensFalhados }, 'Pedido enviado à Linx');

  return {
    pedidoOrigem: `TRAY-${orderId}`,
    codigoCliente,
    clienteNome: customer?.name ?? '',
    clienteDocumento: masked,
    contatoId,
    itensInseridos,
    itensFalhados,
    itens,
  };
}
