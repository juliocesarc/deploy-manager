import fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import fastifyRawBody from 'fastify-raw-body'
import { logger } from '@/logger'
import { webhookRoutes } from './http/controllers/webhook/routes'
import { deploymentsRoutes } from './http/controllers/deployments/routes'
import { healthRoutes } from './http/controllers/health/routes'

export const app = fastify()

app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'],
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: () => ({
    success: false,
    message: 'Too many requests',
  }),
})

app.register(fastifyRawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true })

app.register(webhookRoutes)
app.register(deploymentsRoutes)
app.register(healthRoutes)

app.addHook('onResponse', (request, reply, done) => {
  const route = request.routeOptions?.url ?? request.url
  const method = request.method
  const statusCode = reply.statusCode
  const durationMs = Math.round(reply.elapsedTime)

  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
  logger[level]({ method, route, status_code: statusCode, duration_ms: durationMs }, `${method} ${route}`)

  done()
})

app.setErrorHandler((error, _request, reply) => {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error')
  return reply.status(500).send({ success: false, message: 'Internal server error' })
})
