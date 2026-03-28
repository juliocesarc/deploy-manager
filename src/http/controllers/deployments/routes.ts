import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import {
  listDeployments,
  getDeployment,
  getLatestSuccessfulDeployment,
  createDeployment,
} from '@/models/deployment.model'
import { listProjects, projectExists } from '@/workers/docker.service'
import { getDeployQueue } from '@/workers/deploy.worker'
import { logger } from '@/logger'

export async function deploymentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/deployments', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>
    const { project, environment, limit, offset } = query

    const records = await listDeployments({
      project,
      environment,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    })

    return reply.send({ success: true, data: records })
  })

  app.get('/api/deployments/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string }
    const record = await getDeployment(id)

    if (!record) {
      return reply.status(404).send({ success: false, message: 'Deployment not found' })
    }

    return reply.send({ success: true, data: record })
  })

  app.get('/api/projects', async (_req: FastifyRequest, reply: FastifyReply) => {
    const names = await listProjects()
    return reply.send({ success: true, data: names.map((name) => ({ name })) })
  })

  app.post('/api/rollback', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>
    const { project, environment } = query

    if (!project || !environment) {
      return reply.status(400).send({
        success: false,
        message: 'Missing required query params: project, environment',
      })
    }

    if (!projectExists(project)) {
      return reply.status(404).send({ success: false, message: `Project not found: ${project}` })
    }

    const lastSuccess = await getLatestSuccessfulDeployment(project, environment)
    if (!lastSuccess || !lastSuccess.previousImage) {
      return reply.status(409).send({
        success: false,
        message: 'No previous successful deployment with a known image to roll back to',
      })
    }

    const jobId = uuidv4()
    await createDeployment({
      id: jobId,
      project,
      environment: environment as 'stage' | 'prod',
      image: lastSuccess.previousImage,
      metadata: { trigger: 'manual-rollback', actor: 'api' },
    })

    const queue = getDeployQueue()
    await queue.add(`rollback-${project}-${environment}`, {
      jobId,
      project,
      environment: environment as 'stage' | 'prod',
      image: lastSuccess.previousImage,
      backup: false,
      rollback_on_failure: false,
      receivedAt: new Date().toISOString(),
      metadata: { trigger: 'manual-rollback', actor: 'api' },
    })

    logger.info({ jobId, project, environment, image: lastSuccess.previousImage }, 'Manual rollback queued')

    return reply.status(202).send({
      success: true,
      job_id: jobId,
      message: `Rollback queued for ${project}/${environment} to ${lastSuccess.previousImage}`,
    })
  })

  app.get('/api/queue/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    const queue = getDeployQueue()
    const [waiting, active, failed, completed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
    ])
    return reply.send({ success: true, data: { waiting, active, failed, completed } })
  })
}
