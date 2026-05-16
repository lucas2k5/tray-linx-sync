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

export interface TrayCustomerAddressWrapper {
  CustomerAddress: {
    id?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    recipient?: string;
    type?: string;
  };
}

export interface TrayCustomer {
  id?: string;
  name?: string;
  email?: string;
  cpf?: string;
  cnpj?: string;
  phone?: string;
  cellphone?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  CustomerAddresses?: TrayCustomerAddressWrapper[];
}

export interface TrayProductSold {
  id?: string;
  product_id?: string;
  name?: string;
  reference?: string;
  quantity?: string;
  price?: string;
  original_price?: string;
  cost_price?: string;
  brand?: string;
  model?: string;
  ean?: string;
  weight?: string;
  discount?: string;
}

export interface TrayProductSoldWrapper {
  ProductsSold: TrayProductSold;
}

export interface TrayOrderInvoiceWrapper {
  OrderInvoice?: {
    id?: string;
    number?: string;
    serie?: string;
    value?: string;
    key?: string;
    issue_date?: string;
    xml_danfe?: string;
  };
}

export interface TrayPaymentWrapper {
  Payment?: {
    id?: string;
    method?: string;
    payment_place?: string;
    value?: string;
    date?: string;
    note?: string;
  };
}

export interface TrayMarketplaceOrderWrapper {
  marketplace_name?: string;
  marketplace_order_id?: string;
  marketplace_shipping_id?: string;
  marketplace_seller_name?: string;
}

// Tudo está aninhado dentro de Order — não existe Customer/ProductsSold no topo
export interface TrayOrderComplete {
  Order?: {
    id: string;
    status?: string;
    date?: string;
    total?: string;
    discount?: string;
    shipment_value?: string;
    point_sale?: string;
    payment_method?: string;
    external_code?: string;
    store_note?: string;
    Customer?: TrayCustomer;
    ProductsSold?: TrayProductSoldWrapper[];
    OrderInvoice?: TrayOrderInvoiceWrapper[];
    Payment?: TrayPaymentWrapper[];
    MarketplaceOrder?: TrayMarketplaceOrderWrapper[];
  };
}

export interface LinxStockItem {
  ItemEstoque?: string;
  QuantidadeDisponivel?: number;
  CodigoEstoque?: number;
}
