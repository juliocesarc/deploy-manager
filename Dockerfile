FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install curl (needed for health checks inside the container) and docker CLI
RUN apk add --no-cache curl docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

COPY --from=builder /app/dist ./dist

# Create directories that will be mounted
RUN mkdir -p /projects /data/backups

EXPOSE 3000

USER node

CMD ["node", "dist/server.js"]
