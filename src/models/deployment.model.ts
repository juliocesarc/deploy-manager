import { Pool, PoolClient } from 'pg';
import { DeploymentRecord, DeployStatus, Environment } from '../@types';
import { env } from '../env';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
}

// ─── Migrations ──────────────────────────────────────────────────────────────

export async function runMigrations(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployments (
        id            UUID PRIMARY KEY,
        project       TEXT NOT NULL,
        environment   TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        image         TEXT NOT NULL,
        previous_image TEXT,
        health_check_passed BOOLEAN,
        duration_ms   INTEGER,
        backup_path   TEXT,
        error         TEXT,
        metadata      JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_deployments_project_env
        ON deployments(project, environment);

      CREATE INDEX IF NOT EXISTS idx_deployments_created_at
        ON deployments(created_at DESC);
    `);
  } finally {
    client.release();
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): DeploymentRecord {
  return {
    id: row.id as string,
    project: row.project as string,
    environment: row.environment as Environment,
    status: row.status as DeployStatus,
    image: row.image as string,
    previousImage: (row.previous_image as string) ?? null,
    healthCheckPassed: row.health_check_passed as boolean | null,
    durationMs: row.duration_ms as number | null,
    backupPath: row.backup_path as string | null,
    error: row.error as string | null,
    metadata: row.metadata as Record<string, string | undefined> | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export async function createDeployment(params: {
  id: string;
  project: string;
  environment: Environment;
  image: string;
  metadata?: Record<string, string | undefined> | null;
}): Promise<DeploymentRecord> {
  const { rows } = await getPool().query(
    `INSERT INTO deployments (id, project, environment, image, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.id, params.project, params.environment, params.image, params.metadata ?? null],
  );
  return rowToRecord(rows[0]);
}

export async function updateDeployment(
  id: string,
  updates: Partial<{
    status: DeployStatus;
    previousImage: string | null;
    healthCheckPassed: boolean;
    durationMs: number;
    backupPath: string | null;
    error: string | null;
  }>,
  client?: PoolClient,
): Promise<void> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.previousImage !== undefined) {
    setClauses.push(`previous_image = $${idx++}`);
    values.push(updates.previousImage);
  }
  if (updates.healthCheckPassed !== undefined) {
    setClauses.push(`health_check_passed = $${idx++}`);
    values.push(updates.healthCheckPassed);
  }
  if (updates.durationMs !== undefined) {
    setClauses.push(`duration_ms = $${idx++}`);
    values.push(updates.durationMs);
  }
  if (updates.backupPath !== undefined) {
    setClauses.push(`backup_path = $${idx++}`);
    values.push(updates.backupPath);
  }
  if (updates.error !== undefined) {
    setClauses.push(`error = $${idx++}`);
    values.push(updates.error);
  }

  values.push(id);
  const query = `UPDATE deployments SET ${setClauses.join(', ')} WHERE id = $${idx}`;
  const executor = client ?? getPool();
  await executor.query(query, values);
}

export async function getDeployment(id: string): Promise<DeploymentRecord | null> {
  const { rows } = await getPool().query('SELECT * FROM deployments WHERE id = $1', [id]);
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function listDeployments(params: {
  project?: string;
  environment?: string;
  limit?: number;
  offset?: number;
}): Promise<DeploymentRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.project) {
    conditions.push(`project = $${idx++}`);
    values.push(params.project);
  }
  if (params.environment) {
    conditions.push(`environment = $${idx++}`);
    values.push(params.environment);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  values.push(limit, offset);
  const { rows } = await getPool().query(
    `SELECT * FROM deployments ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    values,
  );
  return rows.map(rowToRecord);
}

export async function getLatestSuccessfulDeployment(
  project: string,
  environment: string,
): Promise<DeploymentRecord | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM deployments
     WHERE project = $1 AND environment = $2 AND status = 'success'
     ORDER BY created_at DESC LIMIT 1`,
    [project, environment],
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}
