export interface TrayTokenResponse {
  access_token: string;
  refresh_token?: string;
  date_expiration_access_token: string;
  api_host?: string;
}

export interface TrayProduct {
  id: string | number;
  reference: string;
  stock: string | number;
}

export interface TrayProductResponse {
  Products?: Array<{ Product: TrayProduct }>;
}

export interface TrayOrderItem {
  id?: string | number;
  reference?: string;
  name?: string;
  price?: string | number;
  Price?: string | number;
  quantity?: string | number;
  Quantity?: string | number;
  discount?: string | number;
  ProductsSold?: TrayOrderItem;
}

export interface TrayCustomer {
  id?: string | number;
  name?: string;
  email?: string;
  cpf?: string;
  cnpj?: string;
  CpfCnpj?: string;
  documento?: string;
  phone?: string;
}

export interface TrayAddress {
  zip_code?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface TrayOrderComplete {
  Order?: {
    id: string | number;
    status?: string;
    date?: string;
    total?: string | number;
    freight_value?: string | number;
    payment_method?: string;
  };
  Customer?: TrayCustomer;
  CustomerAddresses?: TrayAddress[];
  ProductsSold?: TrayOrderItem[];
  Payment?: unknown; // TODO: tipar conforme doc Tray
  OrderInvoice?: unknown; // TODO: tipar conforme doc Tray
}

export interface LinxStockItem {
  ItemEstoque?: string;
  QuantidadeDisponivel?: number;
  CodigoEstoque?: number;
}
