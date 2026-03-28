import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Webhook
  GITHUB_WEBHOOK_SECRET: z.string(),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Docker
  DOCKER_SOCK: z.string().default('/var/run/docker.sock'),

  // Paths
  PROJECTS_DIR: z.string().default('/projects'),
  BACKUPS_DIR: z.string().default('/data/backups'),

  // Health check defaults
  DEFAULT_HEALTH_CHECK_TIMEOUT: z.coerce.number().default(60),
  DEFAULT_HEALTH_CHECK_INTERVAL: z.coerce.number().default(2000),

  // Observability (optional)
  LOKI_HOST: z.string().optional(),
  LOKI_BASIC_AUTH: z.string().optional(),
})

const _env = envSchema.safeParse(process.env)

if (_env.success === false) {
  console.error('Invalid environment variables', _env.error.format())
  throw new Error('Invalid environment variables')
}

export const env = _env.data
