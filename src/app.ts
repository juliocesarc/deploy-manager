import fastify, { FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { logger } from '@/logger'
import { webhookRoutes } from './http/controllers/webhook/routes'
import { deploymentsRoutes } from './http/controllers/deployments/routes'
import { healthRoutes } from './http/controllers/health/routes'

export const app = fastify({ trustProxy: true })

app.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1'],
  keyGenerator: (req: FastifyRequest) => req.ip,
  errorResponseBuilder: () => ({
    success: false,
    message: 'Too many requests',
  }),
})

// Capture raw body for HMAC signature verification on webhook routes
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req: FastifyRequest, body, done) => {
    try {
      (req as FastifyRequest & { rawBody: Buffer }).rawBody = body as Buffer
      done(null, JSON.parse((body as Buffer).toString()))
    } catch (err) {
      done(err as Error, undefined)
    }
  },
)

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
