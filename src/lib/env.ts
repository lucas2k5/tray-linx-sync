import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  TRAY_CONSUMER_KEY: z.string().min(1),
  TRAY_CONSUMER_SECRET: z.string().min(1),
  TRAY_AUTH_CODE: z.string().min(1),
  TRAY_STORE_URL: z.string().url(),

  LINX_API_URL: z.string().url().default('https://auto-gwsmartapi.linx.com.br'),
  LINX_SUBSCRIPTION_KEY: z.string().min(1),
  LINX_AMBIENTE: z.string().min(1),

  WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
