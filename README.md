# Deploy Manager

An agnostic, webhook-driven deploy manager. It listens for signed HTTP webhooks and executes `docker compose pull && up -d` for any registered project — regardless of its stack.

## Philosophy

- **Deploy Manager is an executor**, not an orchestrator
- **Each project owns its workflow** (GitHub Actions, branches, cleanup, etc.)
- **Deploy Manager knows nothing about Git or business logic**
- **It only does**: receive webhook → execute docker compose → validate health → record result

---

## Quick Start

```bash
# 1. Copy and fill in environment variables
cp .env.example .env
# Edit .env — set GITHUB_WEBHOOK_SECRET and POSTGRES_PASSWORD at minimum

# 2. Register a project
./scripts/init-projects.sh my-app
# Then edit /projects/my-app/docker-compose.yaml

# 3. Start everything
docker compose up -d
```

The manager is now listening at `http://localhost:3000` (or behind NGINX on 443).

---

## Architecture

```
POST /webhook/deploy
       │
       ▼
  [Signature Validation]
       │
       ▼
  [BullMQ Queue]          ← Redis backend
       │
       ▼
  [Deploy Worker]
  ├─ backup volumes (optional)
  ├─ update docker-compose.yaml image
  ├─ docker compose pull
  ├─ docker compose up -d
  ├─ health check (with retry)
  └─ rollback on failure (optional)
       │
       ▼
  [PostgreSQL]            ← deployment history
```

---

## Registering a Project

```bash
./scripts/init-projects.sh project-name
```

This creates `/projects/project-name/docker-compose.yaml` with a starter template.
Edit it to match your actual image, ports, and environment variables.

Deploy Manager auto-discovers any directory under `/projects/` that contains a `docker-compose.yaml`.

---

## Webhook API

### `POST /webhook/deploy`

**Headers:**
```
X-Hub-Signature-256: sha256=<hmac-sha256>
Content-Type: application/json
```

**Body:**
```json
{
  "project": "my-app",
  "environment": "stage",
  "image": "ghcr.io/org/my-app:sha-abc123",
  "backup": false,
  "rollback_on_failure": true,
  "health_check_path": "/health",
  "health_check_timeout": 60,
  "metadata": {
    "branch": "main",
    "commit": "abc123",
    "actor": "github-actions",
    "trigger": "push"
  }
}
```

**Response `202 Accepted`:**
```json
{
  "success": true,
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Deploy queued for my-app/stage"
}
```

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Manager health status |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/api/projects` | List registered projects |
| `GET` | `/api/deployments` | Deployment history (query: `project`, `environment`, `limit`, `offset`) |
| `GET` | `/api/deployments/:id` | Single deployment by job ID |
| `POST` | `/api/rollback` | Manual rollback (query: `project`, `environment`) |
| `GET` | `/api/queue/stats` | BullMQ queue statistics |

---

## GitHub Actions Integration

```yaml
# .github/workflows/deploy.yml (in your project's repo)
- name: Trigger Deploy Manager
  run: |
    PAYLOAD=$(jq -cn \
      --arg project "${{ github.event.repository.name }}" \
      --arg env "prod" \
      --arg image "ghcr.io/${{ github.repository }}:${{ github.sha }}" \
      '{project: $project, environment: $env, image: $image,
        backup: true, rollback_on_failure: true,
        health_check_path: "/health", health_check_timeout: 60,
        metadata: {branch: "main", commit: "${{ github.sha }}",
                   actor: "${{ github.actor }}", trigger: "github-actions"}}')

    SIG=$(echo -n "$PAYLOAD" | \
      openssl dgst -sha256 -hmac "${{ secrets.DEPLOY_MANAGER_SECRET }}" | \
      sed 's/.* //')

    curl -sf -X POST \
      "https://${{ secrets.DEPLOY_MANAGER_HOST }}/webhook/deploy" \
      -H "X-Hub-Signature-256: sha256=$SIG" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD"
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_WEBHOOK_SECRET` | Yes | — | HMAC secret shared with GitHub Actions |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for BullMQ |
| `PORT` | No | `3000` | HTTP port |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `PROJECTS_DIR` | No | `/projects` | Project compose files root |
| `BACKUPS_DIR` | No | `/data/backups` | Volume backup destination |
| `DEFAULT_HEALTH_CHECK_TIMEOUT` | No | `60` | Seconds to wait for healthy |
| `DEFAULT_HEALTH_CHECK_INTERVAL` | No | `2000` | ms between health check polls |
| `LOKI_HOST` | No | — | Loki push URL (e.g. `http://loki:3100`) |
| `LOKI_BASIC_AUTH` | No | — | `user:password` for Loki basic auth |

---

## Observability

### Logs (Pino → Loki)

Set `LOKI_HOST` to ship structured JSON logs directly to Loki.
Labels: `job=deploy-manager`, `service=deploy-manager`, `environment=<NODE_ENV>`.

### Metrics (Prometheus)

`GET /metrics` exposes:

| Metric | Type | Labels |
|--------|------|--------|
| `deploy_manager_deployments_total` | Counter | `project`, `environment`, `status` |
| `deploy_manager_deployments_duration_seconds` | Histogram | `project`, `environment` |
| `deploy_manager_health_checks_passed_total` | Counter | `project`, `environment` |
| `deploy_manager_health_checks_failed_total` | Counter | `project`, `environment` |
| `deploy_manager_rollbacks_total` | Counter | `project`, `environment` |
| `deploy_manager_queue_size` | Gauge | — |
| `deploy_manager_webhook_requests_total` | Counter | `status` |

Add a Prometheus scrape job:
```yaml
- job_name: deploy-manager
  static_configs:
    - targets: ['deploy-manager-host:3000']
```

---

## Security

- HMAC-SHA256 signature validation on every webhook request (constant-time comparison)
- Rate limiting: 60 req/min per IP on webhook, 10 req/s at NGINX level
- Docker socket mounted read-only inside the container
- Projects directory mounted read-write (needed for image updates in compose files)
- Secrets only via environment variables, never committed
- NGINX terminates TLS; API endpoints can be restricted by IP

---

## Development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # ts-node-dev with hot reload
npm test               # jest
npm run build          # tsc → dist/
```

---

## SSL Certificates

Place your certificates in `nginx/ssl/`:
- `nginx/ssl/fullchain.pem`
- `nginx/ssl/privkey.pem`

With Let's Encrypt + Certbot:
```bash
certbot certonly --standalone -d your-domain.com
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/
```
