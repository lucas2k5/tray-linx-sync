import axios from 'axios';
import { env } from '../../lib/env.js';
import type { TrayOrderComplete } from '../../types/tray.js';

export async function getTrayOrderComplete(orderId: string, token: string): Promise<TrayOrderComplete> {
  const response = await axios.get<TrayOrderComplete>(
    `${env.TRAY_STORE_URL}/web_api/orders/${orderId}/complete`,
    { params: { access_token: token } }
  );
  return response.data;
}
