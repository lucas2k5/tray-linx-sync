import axios from 'axios';
import { env } from './env.js';
import { logger } from './logger.js';

export interface AlertPayload {
  scopeId: string;
  attempts: number;
  errorMessage: string;
}

export async function sendFailureAlert(payload: AlertPayload): Promise<void> {
  const { scopeId, attempts, errorMessage } = payload;

  logger.error(
    { scopeId, attempts, errorMessage },
    'ALERTA: pedido marcado como FAILED — requer intervenção manual'
  );

  if (!env.ALERT_WEBHOOK_URL) return;

  const body = buildWebhookBody(payload);

  try {
    await axios.post(env.ALERT_WEBHOOK_URL, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    logger.info({ scopeId }, 'Alerta de falha enviado via webhook');
  } catch (err: unknown) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Falha ao enviar alerta via webhook'
    );
  }
}

// Formato compatível com Slack Incoming Webhooks e similares (Discord, Make, Zapier)
function buildWebhookBody(payload: AlertPayload): Record<string, unknown> {
  const { scopeId, attempts, errorMessage } = payload;
  const text = `🚨 *Pedido FAILED*\nID: \`${scopeId}\`\nTentativas: ${attempts}\nErro: ${errorMessage}`;

  return {
    text,
    // Slack-style blocks (ignorado por outros providers que não suportam)
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}
