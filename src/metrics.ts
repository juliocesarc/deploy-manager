import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

export const metrics = {
  deployments: new Counter({
    name: 'deploy_manager_deployments_total',
    help: 'Total number of deployments processed',
    labelNames: ['project', 'environment', 'status'] as const,
    registers: [register],
  }),

  deploymentDuration: new Histogram({
    name: 'deploy_manager_deployments_duration_seconds',
    help: 'Duration of deployments in seconds',
    labelNames: ['project', 'environment'] as const,
    buckets: [10, 30, 60, 120, 300, 600],
    registers: [register],
  }),

  healthChecksPassed: new Counter({
    name: 'deploy_manager_health_checks_passed_total',
    help: 'Total health checks that passed',
    labelNames: ['project', 'environment'] as const,
    registers: [register],
  }),

  healthChecksFailed: new Counter({
    name: 'deploy_manager_health_checks_failed_total',
    help: 'Total health checks that failed',
    labelNames: ['project', 'environment'] as const,
    registers: [register],
  }),

  rollbacks: new Counter({
    name: 'deploy_manager_rollbacks_total',
    help: 'Total number of rollbacks triggered',
    labelNames: ['project', 'environment'] as const,
    registers: [register],
  }),

  queueSize: new Gauge({
    name: 'deploy_manager_queue_size',
    help: 'Current number of jobs in the deploy queue',
    registers: [register],
  }),

  webhookRequests: new Counter({
    name: 'deploy_manager_webhook_requests_total',
    help: 'Total webhook requests received',
    labelNames: ['status'] as const,
    registers: [register],
  }),
};
