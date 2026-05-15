import axios from 'axios';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';
import type { TrayTokenResponse } from '../../types/tray.js';

const STORE_ID = 'partsbarao';
const MIN_HOURS_REMAINING = 24;

export async function getTrayToken(): Promise<string> {
  // Tenta reutilizar token salvo no Supabase
  const { data: row } = await supabase
    .from('tray_tokens')
    .select('access_token, expires_at')
    .eq('store_id', STORE_ID)
    .single();

  if (row) {
    const hoursRemaining = (new Date(row.expires_at).getTime() - Date.now()) / 3_600_000;
    if (hoursRemaining > MIN_HOURS_REMAINING) {
      logger.debug('Token Tray reutilizado do Supabase');
      return row.access_token;
    }
  }

  logger.info('Renovando token Tray...');

  const payload = new URLSearchParams({
    consumer_key: env.TRAY_CONSUMER_KEY,
    consumer_secret: env.TRAY_CONSUMER_SECRET,
    code: env.TRAY_AUTH_CODE,
  });

  const response = await axios.post<TrayTokenResponse>(
    `${env.TRAY_STORE_URL}/web_api/auth`,
    payload.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const tokenData = response.data;

  await supabase.from('tray_tokens').upsert({
    store_id: STORE_ID,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    expires_at: tokenData.date_expiration_access_token,
    api_host: tokenData.api_host ?? env.TRAY_STORE_URL,
    raw_response: tokenData as unknown as Record<string, unknown>,
  }, { onConflict: 'store_id' });

  logger.info('Token Tray renovado e salvo no Supabase');
  return tokenData.access_token;
}
