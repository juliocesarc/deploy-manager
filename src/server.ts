import { app } from './app'
import { env } from '@/env'
import { logger } from '@/logger'
import { runMigrations, closePool } from '@/models/deployment.model'
import { startDeployWorker } from '@/workers/deploy.worker'
import { Worker } from 'bullmq'

let worker: Worker | null = null

async function main(): Promise<void> {
  logger.info('Starting deploy-manager')

  await runMigrations()
  logger.info('Database migrations complete')

  worker = startDeployWorker()
  logger.info('Deploy worker started')

  const host = '0.0.0.0'
  await app.listen({ port: env.PORT, host })
  logger.info({ port: env.PORT, host }, 'Server listening')

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...')
    await app.close()
    if (worker) await worker.close()
    await closePool()
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup')
  process.exit(1)
})
