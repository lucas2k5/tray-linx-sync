export interface LinxStockApiItem {
  ItemEstoque?: string;
  ItemEstoquePublico?: string;
  CodigoEstoque?: number;
  QuantidadeDisponivel?: number;
  DescricaoItemEstoque?: string;
  Preco?: number;
}

export interface LinxClienteResult {
  Codigo?: number;
  CodigoCliente?: number;
  Nome?: string;
  CnpjCpf?: string;
}

export interface LinxClienteResponse {
  Clientes?: LinxClienteResult[];
}

export interface LinxConsultaClienteResult {
  Cliente: number;
  Nome?: string;
  Cpf?: number;
  Cgc?: string;
  [key: string]: unknown;
}

export interface LinxCadastrarClienteResponse {
  Cliente: number;
}

// InserirContato retorna número inteiro direto (ex: 60833), não JSON
export type LinxInserirContatoResponse = number;

// InserirItem retorna string (ex: "Item alterado com sucesso!")
export type LinxInserirItemResponse = string;

export interface LinxItemDetalhe {
  reference: string;
  codigoEstoque: number | null;
  quantidade: number;
  status: 'inserido' | 'falhou' | 'sem_codigo' | 'sem_reference';
  erro?: string;
}

export interface LinxOrderPayload {
  pedidoOrigem: string;
  codigoCliente: number;
  clienteNome: string;
  clienteDocumento: string;
  contatoId: number;
  itensInseridos: number;
  itensFalhados: number;
  itens: LinxItemDetalhe[];
}

export interface NormalizedStockItem {
  trayProductId: string;
  stock: number;
}
