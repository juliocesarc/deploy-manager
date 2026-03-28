import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { env } from '@/env'
import { DeployWebhookPayload, DeployJobData } from '@/@types'
import { validateSignature } from '@/utils/signature'
import { createDeployment } from '@/models/deployment.model'
import { getDeployQueue } from '@/workers/deploy.worker'
import { logger } from '@/logger'
import { metrics } from '@/metrics'

const VALID_ENVIRONMENTS = new Set(['stage', 'prod'])

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook/deploy', { config: { rawBody: true } }, async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody
      ? Buffer.from((req as FastifyRequest & { rawBody: string }).rawBody)
      : Buffer.from(JSON.stringify(req.body))

    if (!validateSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET)) {
      metrics.webhookRequests.inc({ status: 'unauthorized' })
      logger.warn({ ip: req.ip }, 'Invalid webhook signature')
      return reply.status(401).send({ success: false, message: 'Invalid signature' })
    }

    const payload = req.body as DeployWebhookPayload

    if (!payload.project || typeof payload.project !== 'string') {
      metrics.webhookRequests.inc({ status: 'bad_request' })
      return reply.status(400).send({ success: false, message: 'Missing or invalid: project' })
    }

    if (!VALID_ENVIRONMENTS.has(payload.environment)) {
      metrics.webhookRequests.inc({ status: 'bad_request' })
      return reply.status(400).send({
        success: false,
        message: `Invalid environment. Must be one of: ${[...VALID_ENVIRONMENTS].join(', ')}`,
      })
    }

    if (!payload.image || typeof payload.image !== 'string') {
      metrics.webhookRequests.inc({ status: 'bad_request' })
      return reply.status(400).send({ success: false, message: 'Missing or invalid: image' })
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(payload.project)) {
      metrics.webhookRequests.inc({ status: 'bad_request' })
      return reply.status(400).send({ success: false, message: 'project name contains invalid characters' })
    }

    const jobId = uuidv4()

    await createDeployment({
      id: jobId,
      project: payload.project,
      environment: payload.environment,
      image: payload.image,
      metadata: payload.metadata ?? null,
    })

    const jobData: DeployJobData = {
      ...payload,
      jobId,
      receivedAt: new Date().toISOString(),
    }

    const queue = getDeployQueue()
    await queue.add(`deploy-${payload.project}-${payload.environment}`, jobData, {
      jobId,
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    })

    metrics.webhookRequests.inc({ status: 'accepted' })
    logger.info({ jobId, project: payload.project, environment: payload.environment, image: payload.image }, 'Deploy job queued')

    return reply.status(202).send({
      success: true,
      job_id: jobId,
      message: `Deploy queued for ${payload.project}/${payload.environment}`,
    })
  })
}
