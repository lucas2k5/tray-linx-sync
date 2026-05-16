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

export interface LinxCadastrarClienteResponse {
  Cliente: number;
}

// InserirContato retorna número inteiro direto (ex: 60833), não JSON
export type LinxInserirContatoResponse = number;

// InserirItem retorna string (ex: "Item alterado com sucesso!")
export type LinxInserirItemResponse = string;

export interface LinxOrderPayload {
  pedidoOrigem: string;
  contatoId: number;
  itensInseridos: number;
  itensFalhados: number;
}

export interface NormalizedStockItem {
  trayProductId: string;
  stock: number;
}
