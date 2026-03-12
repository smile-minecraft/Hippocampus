# Hippocampus

Hippocampus is a hybrid Next.js + BullMQ worker architecture project designed for high-performance analytical workloads and resilient AI operations.

## Deployment Guide

This guide covers the manual deployment process for Hippocampus on a production server.

### Prerequisites

Before you begin, ensure you have the following:

- **VPS**: A Linux-based Virtual Private Server (Ubuntu 22.04+ recommended).
- **Domain**: A registered domain name (e.g., `example.com`).
- **DNS Setup**: Point your domain's A record to your VPS IP address.
- **Docker & Docker Compose**: Installed on your VPS.
- **Node.js**: Installed locally for building the application.

### Environment Variables Setup

1. Copy the example production environment file:
   ```bash
   cp .env.production.example .env.production
   ```
2. Edit `.env.production` and fill in the required values:
   - Database credentials (PostgreSQL/pgvector)
   - Redis connection details (for BullMQ)
   - AI API keys (OpenAI, etc.)
   - Domain and SSL configuration

### One-Click Deployment

We provide a `deploy.sh` script to automate the deployment process.

1. **Build the application locally**:
   ```bash
   cd web && npm install && npm run build
   ```
2. **Run the deployment script**:
   ```bash
   ./deploy.sh
   ```
   This script will:
   - Pull the latest changes (if applicable).
   - Build and start the Docker containers using `docker-compose.prod.yml`.
   - Configure Nginx as a reverse proxy.
   - Set up SSL certificates via Let's Encrypt.

#### Deployment Commands

- **Start (production, IP only)**:
  ```bash
  ./deploy.sh --ip-only
  ```
- **Check logs**:
  ```bash
  ./deploy.sh && tail -50
  ```

### Post-Deployment Verification

After deployment, verify that the system is running correctly:

- **Check health endpoint**:
  ```bash
  curl http://localhost:3000/api/health
  ```
- **Verify Nginx status**:
  ```bash
  sudo systemctl status nginx
  ```
- **Check Docker containers**:
  ```bash
  docker compose -f docker-compose.prod.yml ps
  ```

### Monitoring Setup

Monitoring is handled by the `scripts/monitor.sh` script. It checks the health of the application and workers.

To start monitoring:
```bash
./scripts/monitor.sh
```

### Backup and Restore

#### Backup Procedures

To back up the PostgreSQL database:
```bash
./scripts/backup.sh postgres
```
Backups are stored in the `backups/` directory by default.

#### Restore Procedures

To restore from a backup:
1. Identify the backup file in the `backups/` directory.
2. Use the standard `pg_restore` or `psql` commands to restore the database.

### SSL Renewal

SSL certificates are automatically renewed using `scripts/ssl-renew.sh`. This script should be added to your crontab:
```bash
0 0 1 * * /path/to/scripts/ssl-renew.sh
```

### Troubleshooting Guide

- **Containers not starting**: Check Docker logs using `docker compose -f docker-compose.prod.yml logs`.
- **Nginx errors**: Check Nginx logs at `/var/log/nginx/error.log`.
- **Worker issues**: Monitor the TUI or check BullMQ logs in the application container.
- **Database connection failures**: Ensure the PostgreSQL container is running and the credentials in `.env.production` are correct.
