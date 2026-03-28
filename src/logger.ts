import pino from 'pino';

function buildTransports(): pino.TransportMultiOptions['targets'] {
  const targets: Array<pino.TransportTargetOptions | pino.TransportPipelineOptions> = [
    {
      level: process.env.LOG_LEVEL ?? 'info',
      target: 'pino/file',
      options: { destination: 1 }, // stdout
    },
  ];

  const lokiHost = process.env.LOKI_HOST;
  if (lokiHost) {
    targets.push({
      level: 'info',
      target: 'pino-loki',
      options: {
        host: lokiHost,
        labels: {
          job: 'deploy-manager',
          service: 'deploy-manager',
          environment: process.env.NODE_ENV ?? 'development',
        },
        // Basic auth if provided
        ...(process.env.LOKI_BASIC_AUTH
          ? { basicAuth: process.env.LOKI_BASIC_AUTH }
          : {}),
      },
    });
  }

  return targets;
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'deploy-manager',
      env: process.env.NODE_ENV ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.transport({ targets: buildTransports() }),
);
