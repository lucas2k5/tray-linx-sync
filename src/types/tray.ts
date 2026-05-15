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

export interface TrayCustomerAddress {
  id?: string | number;
  zip_code?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  type?: string;
  recipient?: string;
}

export interface TrayCustomer {
  id?: string | number;
  name?: string;
  email?: string;
  cpf?: string;
  cnpj?: string;
  phone?: string;
  cellphone?: string;
  zip_code?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  CustomerAddresses?: Array<{ CustomerAddress: TrayCustomerAddress }>;
}

export interface TrayOrderItem {
  // Tray wraps each item in a ProductsSold key within the array
  ProductsSold?: {
    id?: string | number;
    reference?: string;
    name?: string;
    price?: string | number;
    quantity?: string | number;
    discount?: string | number;
    product_id?: string | number;
  };
  // Fallback for flat format
  id?: string | number;
  reference?: string;
  price?: string | number;
  quantity?: string | number;
  discount?: string | number;
}

// Customer, ProductsSold, Payment e OrderInvoice são todos filhos de Order
export interface TrayOrderComplete {
  Order?: {
    id: string | number;
    status?: string;
    date?: string;
    total?: string | number;
    payment_method?: string;
    shipment_value?: string | number;
    billing_address?: string;
    Customer?: TrayCustomer;
    ProductsSold?: TrayOrderItem[];
    Payment?: unknown; // TODO: tipar conforme doc Tray
    OrderInvoice?: unknown; // TODO: tipar conforme doc Tray
  };
}

export interface LinxStockItem {
  ItemEstoque?: string;
  QuantidadeDisponivel?: number;
  CodigoEstoque?: number;
}
