#!/usr/bin/env bash
#
# Hippocampus Health Monitoring Script
# Monitors services and sends Discord notifications on failures
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Service container names
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-hippocampus-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-hippocampus-redis}"
MINIO_CONTAINER="${MINIO_CONTAINER:-hippocampus-minio}"
WEB_CONTAINER="${WEB_CONTAINER:-hippocampus-web}"
WORKER_CONTAINER="${WORKER_CONTAINER:-hippocampus-worker}"
EXPLANATION_WORKER_CONTAINER="${EXPLANATION_WORKER_CONTAINER:-hippocampus-explanation-worker}"

# Service endpoints
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
WEB_ENDPOINT="${WEB_ENDPOINT:-http://localhost:3000}"

# Load .env from web directory if it exists
if [[ -f "$PROJECT_DIR/web/.env" ]]; then
    # shellcheck source=/dev/null
    set -a
    source "$PROJECT_DIR/web/.env"
    set +a
fi

# =============================================================================
# Colors for terminal output
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Print functions
# =============================================================================
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# =============================================================================
# Service Health Check Functions
# =============================================================================

check_postgres() {
    local status="unhealthy"
    local message="PostgreSQL is down"

    if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
        if docker exec "$POSTGRES_CONTAINER" pg_isready -U "${POSTGRES_USER:-hippocampus}" -d "${POSTGRES_DB:-hippocampus}" > /dev/null 2>&1; then
            status="healthy"
            message="PostgreSQL is responding"
        else
            message="PostgreSQL container running but not responding"
        fi
    else
        message="PostgreSQL container not running"
    fi

    echo "${status}|${message}"
}

check_redis() {
    local status="unhealthy"
    local message="Redis is down"

    if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
        if docker exec "$REDIS_CONTAINER" redis-cli ping > /dev/null 2>&1; then
            status="healthy"
            message="Redis is responding"
        else
            message="Redis container running but not responding"
        fi
    else
        message="Redis container not running"
    fi

    echo "${status}|${message}"
}

check_minio() {
    local status="unhealthy"
    local message="MinIO is down"

    if docker ps --format '{{.Names}}' | grep -q "^${MINIO_CONTAINER}$"; then
        if curl -sf "${MINIO_ENDPOINT}/minio/health/ready" > /dev/null 2>&1; then
            status="healthy"
            message="MinIO is responding"
        else
            message="MinIO container running but health check failed"
        fi
    else
        message="MinIO container not running"
    fi

    echo "${status}|${message}"
}

check_web() {
    local status="unhealthy"
    local message="Web service is down"

    if docker ps --format '{{.Names}}' | grep -q "^${WEB_CONTAINER}$"; then
        if curl -sf "${WEB_ENDPOINT}/api/health" > /dev/null 2>&1; then
            status="healthy"
            message="Web service is responding"
        else
            message="Web container running but health check failed"
        fi
    else
        message="Web container not running"
    fi

    echo "${status}|${message}"
}

check_worker() {
    local status="unhealthy"
    local message="Parser worker is down"

    if docker ps --format '{{.Names}}' | grep -q "^${WORKER_CONTAINER}$"; then
        status="healthy"
        message="Parser worker is running"
    else
        message="Parser worker container not running"
    fi

    echo "${status}|${message}"
}

check_explanation_worker() {
    local status="unhealthy"
    local message="Explanation worker is down"

    if docker ps --format '{{.Names}}' | grep -q "^${EXPLANATION_WORKER_CONTAINER}$"; then
        status="healthy"
        message="Explanation worker is running"
    else
        message="Explanation worker container not running"
    fi

    echo "${status}|${message}"
}

# =============================================================================
# Run all health checks and return results
# =============================================================================
run_health_checks() {
    local results=()

    info "Running health checks..."

    # Check PostgreSQL
    local postgres_result
    postgres_result=$(check_postgres)
    results+=("postgres|${postgres_result}")

    # Check Redis
    local redis_result
    redis_result=$(check_redis)
    results+=("redis|${redis_result}")

    # Check MinIO
    local minio_result
    minio_result=$(check_minio)
    results+=("minio|${minio_result}")

    # Check Web
    local web_result
    web_result=$(check_web)
    results+=("web|${web_result}")

    # Check Workers
    local worker_result
    worker_result=$(check_worker)
    results+=("worker|${worker_result}")

    local explanation_worker_result
    explanation_worker_result=$(check_explanation_worker)
    results+=("explanation_worker|${explanation_worker_result}")

    printf '%s\n' "${results[@]}"
}

# =============================================================================
# Discord Notification
# =============================================================================
send_discord_notification() {
    local webhook_url="${DISCORD_WEBHOOK_URL:-}"

    if [[ -z "$webhook_url" ]]; then
        warn "DISCORD_WEBHOOK_URL not set. Skipping Discord notification."
        return 1
    fi

    local title="${1:-Hippocampus Health Check}"
    local description="${2:-Service status summary}"
    local color="${3:-65280}"  # Default green
    shift 3 || true

    # Build fields JSON from remaining arguments (format: "name|value|status")
    local fields_json=""
    local has_failures=false

    for field_data in "$@"; do
        local name=$(echo "$field_data" | cut -d'|' -f1)
        local value=$(echo "$field_data" | cut -d'|' -f2)
        local status=$(echo "$field_data" | cut -d'|' -f3)

        local emoji="✅"
        if [[ "$status" == "unhealthy" ]]; then
            emoji="❌"
            has_failures=true
        fi

        if [[ -n "$fields_json" ]]; then
            fields_json="${fields_json},"
        fi
        fields_json="${fields_json}{\"name\":\"${name}\",\"value\":\"${emoji} ${value}\",\"inline\":true}"
    done

    # If there are failures, change color to red
    if [[ "$has_failures" == true ]]; then
        color="16711680"  # Red
    fi

    local payload
    payload=$(cat <<EOF
{
  "embeds": [{
    "title": "${title}",
    "description": "${description}",
    "color": ${color},
    "fields": [${fields_json}],
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }]
}
EOF
)

    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$webhook_url" 2>/dev/null || echo -e "\n000")

    local http_code
    http_code=$(echo "$response" | tail -n1)

    if [[ "$http_code" == "204" ]] || [[ "$http_code" == "200" ]]; then
        info "Discord notification sent successfully"
        return 0
    else
        error "Failed to send Discord notification (HTTP $http_code)"
        return 1
    fi
}

# =============================================================================
# Email Notification (Optional - only if SMTP configured)
# =============================================================================
send_email_notification() {
    # Check if SMTP is configured
    if [[ -z "${SMTP_HOST:-}" ]] || [[ -z "${SMTP_USER:-}" ]] || [[ -z "${SMTP_PASS:-}" ]]; then
        debug "SMTP not configured. Skipping email notification."
        return 0
    fi

    local subject="${1:-Hippocampus Health Alert}"
    local body="${2:-}"
    local to="${ALERT_EMAIL:-${SMTP_USER}}"

    # Check if sendmail or similar is available
    if command -v sendmail &> /dev/null; then
        {
            echo "To: $to"
            echo "Subject: $subject"
            echo "Content-Type: text/plain; charset=UTF-8"
            echo ""
            echo "$body"
        } | sendmail "$to"
        info "Email notification sent to $to"
    elif command -v mail &> /dev/null; then
        echo "$body" | mail -s "$subject" "$to"
        info "Email notification sent to $to"
    else
        warn "No mail command available. Skipping email notification."
    fi
}

# =============================================================================
# Auto-restart failed services
# =============================================================================
restart_service() {
    local service_name="$1"
    local container_name="$2"

    info "Attempting to restart $service_name..."

    if docker restart "$container_name" > /dev/null 2>&1; then
        info "$service_name restarted successfully"
        return 0
    else
        error "Failed to restart $service_name"
        return 1
    fi
}

# =============================================================================
# Process health check results
# =============================================================================
process_results() {
    local results=("$@")
    local all_healthy=true
    local failed_services=()
    local discord_fields=()

    info "Health Check Results:"
    echo "----------------------------------------"

    for result in "${results[@]}"; do
        local service=$(echo "$result" | cut -d'|' -f1)
        local status=$(echo "$result" | cut -d'|' -f2)
        local message=$(echo "$result" | cut -d'|' -f3)

        # Format service name for display
        local display_name=""
        case "$service" in
            postgres) display_name="PostgreSQL" ;;
            redis) display_name="Redis" ;;
            minio) display_name="MinIO" ;;
            web) display_name="Web Service" ;;
            worker) display_name="Parser Worker" ;;
            explanation_worker) display_name="Explanation Worker" ;;
            *) display_name="$service" ;;
        esac

        if [[ "$status" == "healthy" ]]; then
            echo -e "${GREEN}✅${NC} ${display_name}: ${message}"
        else
            echo -e "${RED}❌${NC} ${display_name}: ${message}"
            all_healthy=false
            failed_services+=("$service:$display_name")
        fi

        # Add to Discord fields
        discord_fields+=("${display_name}|${message}|${status}")
    done

    echo "----------------------------------------"

    # Send Discord notification
    if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]]; then
        local title="Hippocampus Health Check"
        local description="All services are healthy"
        local color="65280"

        if [[ "$all_healthy" == false ]]; then
            title="⚠️ Hippocampus Health Alert"
            description="One or more services are unhealthy"
            color="16711680"
        fi

        send_discord_notification "$title" "$description" "$color" "${discord_fields[@]}"
    fi

    # Send email notification if configured and there are failures
    if [[ "$all_healthy" == false ]] && [[ -n "${SMTP_HOST:-}" ]]; then
        local email_body="Hippocampus Health Alert\n\nFailed Services:\n"
        for svc in "${failed_services[@]}"; do
            email_body="${email_body}\n- ${svc#*:}"
        done
        send_email_notification "Hippocampus Health Alert" "$email_body"
    fi

    # Auto-restart if enabled
    if [[ "${AUTO_RESTART:-false}" == "true" ]] && [[ "$all_healthy" == false ]]; then
        info "Auto-restart enabled. Restarting failed services..."
        for svc in "${failed_services[@]}"; do
            local service_name="${svc%%:*}"
            local display_name="${svc#*:}"
            local container_var="${service_name^^}_CONTAINER"
            local container_name="${!container_var:-hippocampus-${service_name}}"

            restart_service "$display_name" "$container_name" || true
        done
    fi

    if [[ "$all_healthy" == true ]]; then
        info "All services are healthy!"
        return 0
    else
        error "Some services are unhealthy!"
        return 1
    fi
}

# =============================================================================
# Test Discord Webhook
# =============================================================================
test_discord() {
    local webhook_url="${DISCORD_WEBHOOK_URL:-}"

    if [[ -z "$webhook_url" ]]; then
        error "DISCORD_WEBHOOK_URL not set. Cannot send test message."
        error "Please set DISCORD_WEBHOOK_URL in your environment or .env file."
        exit 1
    fi

    info "Sending test Discord notification..."

    local payload
    payload=$(cat <<EOF
{
  "embeds": [{
    "title": "🧪 Hippocampus Monitor Test",
    "description": "This is a test message from the Hippocampus health monitoring system.",
    "color": 3447003,
    "fields": [
      {"name": "Status", "value": "✅ Test successful", "inline": true},
      {"name": "Timestamp", "value": "$(date)", "inline": true}
    ],
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }]
}
EOF
)

    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$webhook_url" 2>/dev/null || echo -e "\n000")

    local http_code
    http_code=$(echo "$response" | tail -n1)

    if [[ "$http_code" == "204" ]] || [[ "$http_code" == "200" ]]; then
        info "Test Discord notification sent successfully!"
        info "Check your Discord channel for the test message."
    else
        error "Failed to send test Discord notification (HTTP $http_code)"
        error "Response: $(echo "$response" | head -n -1)"
        exit 1
    fi
}

# =============================================================================
# Show Cron Job Syntax
# =============================================================================
show_cron_syntax() {
    cat << 'EOF'
=== Cron Job for Automatic Health Monitoring ===

Add the following line to your crontab (crontab -e):

# Run health check every 5 minutes
*/5 * * * * /bin/bash /path/to/scripts/monitor.sh --check-health >> /var/log/hippocampus-monitor.log 2>&1

Or to run with notifications on failures only:
*/5 * * * * cd /path/to/project && /bin/bash scripts/monitor.sh >> /var/log/hippocampus-monitor.log 2>&1

=== Environment Variables ===

Add these to your crontab or /etc/environment:

export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export POSTGRES_CONTAINER="hippocampus-postgres"
export REDIS_CONTAINER="hippocampus-redis"
export MINIO_CONTAINER="hippocampus-minio"
export WEB_CONTAINER="hippocampus-web"
export WORKER_CONTAINER="hippocampus-worker"
export EXPLANATION_WORKER_CONTAINER="hippocampus-explanation-worker"

=== Optional SMTP Configuration (for email alerts) ===

export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USER="your-email@gmail.com"
export SMTP_PASS="your-app-password"
export ALERT_EMAIL="admin@example.com"

=== Systemd Timer Alternative ===

--- /etc/systemd/system/hippocampus-monitor.service ---
[Unit]
Description=Hippocampus Health Monitor

[Service]
Type=oneshot
WorkingDirectory=/path/to/project
ExecStart=/bin/bash scripts/monitor.sh --check-health
Environment=DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

--- /etc/systemd/system/hippocampus-monitor.timer ---
[Unit]
Description=Run Hippocampus health monitor every 5 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target

Enable with: systemctl enable --now hippocampus-monitor.timer

EOF
}

# =============================================================================
# Display usage information
# =============================================================================
usage() {
    cat << EOF
Hippocampus Health Monitoring Script

Usage: $(basename "$0") [OPTIONS]

Options:
    --test-discord      Send a test Discord notification
    --check-health      Run health checks and exit with status (0 = all healthy)
    --auto-restart      Automatically restart failed services (use with --check-health)
    --show-cron         Display cron job syntax for automatic monitoring
    -h, --help          Show this help message

Environment Variables:
    DISCORD_WEBHOOK_URL     Discord webhook URL (required for Discord notifications)
    SMTP_HOST               SMTP server host (optional, for email alerts)
    SMTP_PORT               SMTP server port (default: 587)
    SMTP_USER               SMTP username (optional)
    SMTP_PASS               SMTP password (optional)
    ALERT_EMAIL             Email address for alerts (default: SMTP_USER)
    
    *_CONTAINER             Override container names (e.g., POSTGRES_CONTAINER)
    MINIO_ENDPOINT          MinIO URL (default: http://localhost:9000)
    WEB_ENDPOINT            Web service URL (default: http://localhost:3000)

Examples:
    # Run health check with Discord notification
    $(basename "$0") --check-health

    # Test Discord webhook
    $(basename "$0") --test-discord

    # Run checks and auto-restart failed services
    $(basename "$0") --check-health --auto-restart

    # Show cron setup instructions
    $(basename "$0") --show-cron

EOF
}

# =============================================================================
# Main function
# =============================================================================
main() {
    local check_health=false
    local test_discord_flag=false
    local show_cron=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --test-discord)
                test_discord_flag=true
                shift
                ;;
            --check-health)
                check_health=true
                shift
                ;;
            --auto-restart)
                export AUTO_RESTART=true
                shift
                ;;
            --show-cron)
                show_cron=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Show cron syntax if requested
    if [[ "$show_cron" == true ]]; then
        show_cron_syntax
        exit 0
    fi

    # Test Discord if requested
    if [[ "$test_discord_flag" == true ]]; then
        test_discord
        exit 0
    fi

    # Run health checks if requested
    if [[ "$check_health" == true ]]; then
        # Check if Docker is available
        if ! command -v docker &> /dev/null; then
            error "Docker is not installed or not in PATH"
            exit 1
        fi

        # Run checks and process results
        local results
        results=$(run_health_checks)

        if process_results $results; then
            exit 0
        else
            exit 1
        fi
    fi

    # Default: run health checks with full output
    info "Hippocampus Health Monitor"
    info "Use --help for usage information"
    echo ""

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed or not in PATH"
        exit 1
    fi

    # Run checks and process results
    local results
    results=$(run_health_checks)
    process_results $results
}

# Run main function
main "$@"
