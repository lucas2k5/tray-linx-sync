import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import type {
  LinxClienteResult,
  LinxClienteResponse,
  LinxCadastrarClienteResponse,
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

// ─── Helpers de telefone ─────────────────────────────────────────────────────

function parseDDD(phone: string | undefined): number {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? parseInt(digits.substring(0, 2)) : 0;
}

function parseTelefone(phone: string | undefined): number {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length > 2 ? parseInt(digits.substring(2)) : 0;
}

// ─── Passo 1a: Busca cliente na Linx pelo CPF/CNPJ ───────────────────────────
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

// ─── Passo 1b: Cadastra cliente novo na Linx ─────────────────────────────────
async function cadastrarClienteSimplificado(customer: TrayCustomer): Promise<number> {
  const cpfCnpj = (customer.cpf ?? customer.cnpj ?? '').replace(/\D/g, '');
  const tipoPessoa = cpfCnpj.length > 11 ? 1 : 0;
  const cep = parseInt((customer.zip_code ?? '').replace(/\D/g, '') || '0');

  const body = {
    ObrigaCPFCNPJ: true,
    CPFCNPJ: cpfCnpj,
    Identidade: '',
    CEP: cep,
    Cidade: customer.city ?? '',
    UF: customer.state ?? '',
    InscricaoEstadual: '',
    Nome: customer.name ?? '',
    Celular: parseTelefone(customer.cellphone),
    VerificaTelefone: false,
    Telefone: parseTelefone(customer.phone),
    TipoPessoa: tipoPessoa,
    BPVCategoria: false,
    Categoria: 0,
    TipoVia: '',
    DDD: parseDDD(customer.phone),
    DDDCelular: parseDDD(customer.cellphone),
    EmailCasa: customer.email ?? '',
    EmailTrabalho: '',
    Tipo: '',
    CNH: 0,
    RamoAtividade: 0,
    Ramal: 0,
    PaisCelular: 0,
    Endereco: customer.address ?? '',
    Complemento: customer.complement ?? '',
    Bairro: customer.neighborhood ?? '',
    Regiao: 0,
    OrigemCadastro: 'ECOMMERCE',
    Segmento: 0,
    UsuarioVendedor: 0,
    Empresa: CONFIG_ORIGEM.Empresa,
    Revenda: CONFIG_ORIGEM.Revenda,
    Departamento: 0,
    DataNascimento: '',
    EstadoCivil: 0,
    Cliente: 0,
    Fantasia: '',
    ValidarCamposObrigatorios: true,
    Clifor: '',
    EnderecoCobranca: 0,
    BloqueioCredito: '',
    CaixaPostal: '',
    Fax: 0,
    DDDFax: 0,
    Observacao: '',
    Origem: '',
    InscricaoMunicipal: '',
    CadastraCepAutomaticamente: true,
    NaoValidarCepCadastroAutomatico: true,
    ClienteEstrangeiro: '',
    NroPassaporte: '',
    IndicadorInscricaoEstadual: 0,
    BypassValidacaoDocumento: true,
    RecebeEmail: '',
    RecebeTelefonema: '',
    RecebeSms: '',
  };

  const response = await axios.post<LinxCadastrarClienteResponse>(
    `${LINX_ENDPOINT}/Geral/ManutencaoClienteSimplificado/CadastrarClienteSimplificado`,
    body,
    { headers: LINX_HEADERS }
  );

  const data = response.data;
  const codigoCliente = data.Cliente ?? data.CodigoCliente ?? data.Codigo;

  if (!codigoCliente) {
    throw new Error('CadastrarClienteSimplificado não retornou código de cliente');
  }

  return Number(codigoCliente);
}

// ─── Passo 2: Cria atendimento na Linx ───────────────────────────────────────
async function inserirContato(codigoCliente: number, orderId: string | number): Promise<number> {
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
    Empresa: CONFIG_ORIGEM.Empresa,
    Revenda: CONFIG_ORIGEM.Revenda,
    Usuario: CONFIG_ORIGEM.Usuario,
    CodigoOrigem: CONFIG_ORIGEM.CodigoOrigem,
    IdentificadorOrigem: `TRAY-${orderId}`,
    ClienteContactado: true,
    NroSolicitacao: 0,
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
  return customer.cpf ?? customer.cnpj ?? '';
}

function mapTrayItemsToLinx(
  productsSold: TrayOrderItem[] | undefined
): Array<{ ItemEstoque: number; Quantidade: number; ValorUnitario: number; Desconto: number }> {
  if (!productsSold?.length) return [];

  return productsSold
    .map((entry) => {
      const item = entry.ProductsSold ?? entry;
      const itemEstoque = parseInt(String(item.reference ?? item.id ?? 0));
      if (!itemEstoque) return null;
      return {
        ItemEstoque: itemEstoque,
        Quantidade: parseFloat(String(item.quantity ?? 1)),
        ValorUnitario: parseFloat(String(item.price ?? 0)),
        Desconto: parseFloat(String(item.discount ?? 0)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

// ─── Orquestrador principal ───────────────────────────────────────────────────
export async function sendOrderToLinx(trayOrderData: TrayOrderComplete): Promise<LinxOrderPayload> {
  const order = trayOrderData.Order;
  const orderId = order?.id ?? 'unknown';
  const log = logger.child({ orderId: `TRAY-${orderId}` });

  log.info('Iniciando envio para Linx AutoShop');

  const customer = order?.Customer;

  // Passo 1 — buscar cliente, cadastrar se não existir
  const documento = extrairDocumento(customer);
  let codigoCliente = 0;

  if (documento) {
    const masked = documento.slice(0, -3).replace(/\d/g, '*') + documento.slice(-3);
    log.info({ doc: masked }, 'Buscando cliente na Linx');
    try {
      const clienteLinx = await buscarClienteLinx(documento);
      if (clienteLinx) {
        codigoCliente = clienteLinx.Codigo ?? clienteLinx.CodigoCliente ?? 0;
        log.info({ codigoCliente }, 'Cliente encontrado na Linx');
      } else if (customer) {
        log.info('Cliente não encontrado — cadastrando na Linx');
        codigoCliente = await cadastrarClienteSimplificado(customer);
        log.info({ codigoCliente }, 'Cliente cadastrado na Linx');
      } else {
        log.warn('Cliente não encontrado e sem dados para cadastrar');
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Erro ao buscar/criar cliente — continuando sem vínculo');
    }
  } else {
    log.warn('Pedido sem CPF/CNPJ no payload Tray');
  }

  // Passo 2 — criar atendimento
  const contatoId = await inserirContato(codigoCliente, orderId);
  log.info({ contatoId }, 'Atendimento criado na Linx');

  // Passo 3 — inserir itens
  const itens = mapTrayItemsToLinx(order?.ProductsSold);
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

  return { pedidoOrigem: `TRAY-${orderId}`, raw: trayOrderData };
}
