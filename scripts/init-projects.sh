#!/usr/bin/env bash
# init-projects.sh — Bootstrap the /projects directory structure
# Usage: ./scripts/init-projects.sh [project-name]
set -euo pipefail

PROJECTS_DIR="${PROJECTS_DIR:-/projects}"

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <project-name>"
  exit 1
fi

PROJECT="$1"
PROJECT_DIR="$PROJECTS_DIR/$PROJECT"

if [[ "$PROJECT" =~ [^a-zA-Z0-9_-] ]]; then
  echo "Error: project name must be alphanumeric, dash or underscore only."
  exit 1
fi

if [[ -d "$PROJECT_DIR" ]]; then
  echo "Project '$PROJECT' already exists at $PROJECT_DIR"
  exit 0
fi

mkdir -p "$PROJECT_DIR"

cat > "$PROJECT_DIR/docker-compose.yaml" <<EOF
version: "3.8"

services:
  app:
    image: ghcr.io/your-org/${PROJECT}:latest
    container_name: ${PROJECT}
    restart: unless-stopped
    ports:
      - "3001:3000"   # Change host port to avoid conflicts
    environment:
      - NODE_ENV=\${ENVIRONMENT:-stage}
    volumes:
      - ${PROJECT}-data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  ${PROJECT}-data:
EOF

echo "Project '$PROJECT' created at $PROJECT_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit $PROJECT_DIR/docker-compose.yaml"
echo "     - Set the correct image repository"
echo "     - Set the correct host port"
echo "     - Add any required environment variables or secrets"
echo "  2. In your GitHub Actions workflow, set:"
echo "     - DEPLOY_MANAGER_HOST: your-vps-hostname"
echo "     - GITHUB_WEBHOOK_SECRET: (same secret as in .env)"
