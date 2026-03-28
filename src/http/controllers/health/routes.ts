import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getPool } from '@/models/deployment.model'
import { register } from '@/metrics'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    let dbOk = false
    try {
      await getPool().query('SELECT 1')
      dbOk = true
    } catch {
      dbOk = false
    }

    const status = dbOk ? 'ok' : 'degraded'
    const httpStatus = dbOk ? 200 : 503

    return reply.status(httpStatus).send({
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? 'ok' : 'error',
      },
    })
  })

  app.get('/metrics', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/plain; version=0.0.4; charset=utf-8')
    return register.metrics()
  })
}
