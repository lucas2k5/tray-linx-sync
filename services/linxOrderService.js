import axios from 'axios';

const LINX_API_URL = process.env.LINX_API_URL || 'https://auto-gwsmartapi.linx.com.br';
const LINX_SUBSCRIPTION_KEY = process.env.LINX_SUBSCRIPTION_KEY;
const LINX_AMBIENTE = process.env.LINX_AMBIENTE;

function transformTrayOrderToLinx(trayOrder) {
  const order = trayOrder.Order || trayOrder;

  return {
    pedidoOrigem: `TRAY-${order.id}`,
    // TODO: mapear campos completos conforme documentação da Linx AutoShop.
    // Campos disponíveis no trayOrder:
    //   order.id, order.status, order.date, order.total, order.freight_value
    //   order.Customer → dados do cliente (name, email, cpf, cnpj)
    //   order.CustomerAddresses → endereços de entrega e cobrança
    //   order.ProductsSold → itens do pedido (reference, price, quantity)
    //   order.Payment → dados de pagamento
    //   order.OrderInvoice → nota fiscal
    raw: trayOrder,
  };
}

export async function sendOrderToLinx(trayOrderData) {
  const payload = transformTrayOrderToLinx(trayOrderData);
  const orderId = payload.pedidoOrigem;

  console.log(`📤 Enviando pedido ${orderId} para Linx AutoShop...`);
  console.log('📦 Payload transformado para Linx:', JSON.stringify(payload, null, 2));

  // TODO: descomentar quando o endpoint e credenciais Linx estiverem definidos.
  // const response = await axios.post(
  //   `${LINX_API_URL}/api-e-commerce-premium/ENDPOINT_PEDIDO`,
  //   payload,
  //   {
  //     headers: {
  //       'Content-Type': 'application/json-patch+json',
  //       'Ocp-Apim-Subscription-Key': LINX_SUBSCRIPTION_KEY,
  //       Ambiente: LINX_AMBIENTE,
  //     },
  //   }
  // );
  // return response.data;

  return { success: true, message: `Pedido ${orderId} logado (envio Linx pendente de configuração)` };
}
