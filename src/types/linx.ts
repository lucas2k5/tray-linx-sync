export interface LinxConfigBase {
  Empresa: number;
  Revenda: number;
  Usuario: number;
  CodigoOrigem: number;
  IdentificadorOrigem: string;
  ClienteContactado: boolean;
}

export interface LinxStockApiItem {
  ItemEstoque?: string;
  QuantidadeDisponivel?: number;
  CodigoEstoque?: number;
  DescricaoItem?: string;
  PrecoPublico?: number;
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

// TODO: tipar resposta completa de InserirContato e InserirItem conforme doc Linx
export type LinxInserirContatoResponse = Record<string, unknown>;
export type LinxInserirItemResponse = Record<string, unknown>;

export interface LinxOrderPayload {
  pedidoOrigem: string;
  raw: unknown;
}

export interface NormalizedStockItem {
  trayProductId: string;
  stock: number;
}
