export type Environment = 'stage' | 'prod';

export interface DeployWebhookPayload {
  project: string;
  environment: Environment;
  image: string;
  backup?: boolean;
  rollback_on_failure?: boolean;
  health_check_path?: string;
  health_check_timeout?: number;
  metadata?: {
    branch?: string;
    commit?: string;
    actor?: string;
    trigger?: string;
    [key: string]: string | undefined;
  };
}

export interface DeployJobData extends DeployWebhookPayload {
  jobId: string;
  receivedAt: string;
}

export type DeployStatus = 'queued' | 'running' | 'success' | 'failed' | 'rolled_back';

export interface DeploymentRecord {
  id: string;
  project: string;
  environment: Environment;
  status: DeployStatus;
  image: string;
  previousImage: string | null;
  healthCheckPassed: boolean | null;
  durationMs: number | null;
  backupPath: string | null;
  error: string | null;
  metadata: Record<string, string | undefined> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeployResult {
  success: boolean;
  jobId: string;
  message: string;
  details?: {
    previousImage: string | null;
    newImage: string;
    healthCheckPassed: boolean;
    durationMs: number;
    backupPath: string | null;
  };
}

export interface ProjectInfo {
  name: string;
  path: string;
  environments: string[];
}
