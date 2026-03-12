#!/bin/bash
# =============================================================================
# Hippocampus — One-Click Deployment Script (Infrastructure)
# =============================================================================
# Usage: ./deploy.sh [OPTIONS]
#
# Options:
#   --dry-run       Show what would be done without making changes
#   --force-clean   Remove existing containers and volumes (fresh install)
#   --ip-only       Skip SSL setup, use HTTP only (for testing before domain)
#   --help          Show this help message
#
# Requirements:
#   - Ubuntu/Debian Linux (for auto-installation of Docker)
#   - Root/sudo access for installation steps
#   - Environment variables in .env file
#
# Logging: /var/log/hippocampus-deploy.log
# =============================================================================

set -o pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
LOG_FILE="/var/log/hippocampus-deploy.log"
LOCK_FILE="/tmp/hippocampus-deploy.lock"

# Compose files
COMPOSE_DEV="${SCRIPT_DIR}/docker-compose.yml"
COMPOSE_PROD="${SCRIPT_DIR}/docker-compose.prod.yml"
COMPOSE_FILE=""

# Directory structure
DATA_DIR="${SCRIPT_DIR}/data"
REQUIRED_DIRS=(
    "${DATA_DIR}/postgres"
    "${DATA_DIR}/redis"
    "${DATA_DIR}/minio"
    "${DATA_DIR}/certbot"
    "${DATA_DIR}/certbot/www"
    "${DATA_DIR}/certbot/conf"
    "${DATA_DIR}/backups"
    "${DATA_DIR}/backups/postgres"
    "${DATA_DIR}/backups/minio"
)

# Service health check timeouts (seconds)
HEALTH_TIMEOUT=120
HEALTH_INTERVAL=5

# Rollback state
ROLLBACK_NEEDED=false
PREVIOUS_CONTAINERS=""

# =============================================================================
# Flags
# =============================================================================

DRY_RUN=false
FORCE_CLEAN=false
IP_ONLY=false

# =============================================================================
# Logging Functions
# =============================================================================

log_init() {
    # Create log directory if needed
    local log_dir
    log_dir="$(dirname "$LOG_FILE")"
    
    if [[ ! -d "$log_dir" ]]; then
        mkdir -p "$log_dir" 2>/dev/null || {
            echo "[WARN] Cannot create log directory $log_dir, logging to stdout only"
            LOG_FILE="/dev/null"
        }
    fi
    
    # Check if we can write to log file
    if [[ ! -w "$LOG_FILE" ]] && [[ ! -w "$log_dir" ]]; then
        echo "[WARN] Cannot write to $LOG_FILE, logging to stdout only"
        LOG_FILE="/dev/null"
    fi
}

log() {
    local level="$1"
    local message="$2"
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    
    echo "[${timestamp}] [${level}] ${message}" | tee -a "$LOG_FILE"
}

log_info()  { log "INFO" "$1"; }
log_warn()  { log "WARN" "$1"; }
log_error() { log "ERROR" "$1"; }
log_step()  { log "STEP" "$1"; }
log_dry()   { log "DRY-RUN" "$1"; }

# =============================================================================
# Utility Functions
# =============================================================================

show_help() {
    cat << EOF
Hippocampus Deployment Script

Usage: $SCRIPT_NAME [OPTIONS]

Options:
    --dry-run       Show what would be done without making changes
    --force-clean   Remove existing containers and volumes (DESTRUCTIVE)
    --ip-only       Skip SSL setup, use HTTP only (testing mode)
    --help          Show this help message

Environment Variables (via .env file):
    POSTGRES_USER       PostgreSQL username
    POSTGRES_PASSWORD   PostgreSQL password
    POSTGRES_DB         PostgreSQL database name
    MINIO_ROOT_USER     MinIO admin username
    MINIO_ROOT_PASSWORD MinIO admin password

Examples:
    # Dry run to see what would happen
    $SCRIPT_NAME --dry-run

    # Fresh installation (removes existing data)
    $SCRIPT_NAME --force-clean

    # IP-only mode for testing without domain
    $SCRIPT_NAME --ip-only

    # Normal deployment
    $SCRIPT_NAME

Logging: $LOG_FILE
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force-clean)
                FORCE_CLEAN=true
                shift
                ;;
            --ip-only)
                IP_ONLY=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

check_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        local pid
        pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if kill -0 "$pid" 2>/dev/null; then
            log_error "Another deployment is in progress (PID: $pid)"
            exit 1
        else
            log_warn "Removing stale lock file"
            rm -f "$LOCK_FILE"
        fi
    fi
    
    echo $$ > "$LOCK_FILE"
    trap 'rm -f "$LOCK_FILE"' EXIT
}

dry_run_exec() {
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would execute: $*"
        return 0
    fi
    "$@"
}

# =============================================================================
# Docker Installation Functions
# =============================================================================

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        echo "$ID"
    elif [[ -f /etc/debian_version ]]; then
        echo "debian"
    else
        echo "unknown"
    fi
}

check_docker() {
    if command -v docker &>/dev/null; then
        log_info "Docker is installed: $(docker --version)"
        return 0
    else
        log_info "Docker is not installed"
        return 1
    fi
}

install_docker_debian() {
    log_step "Installing Docker on Debian/Ubuntu..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would install Docker using apt"
        return 0
    fi
    
    # Update package index
    apt-get update
    
    # Install dependencies
    apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker's official GPG key
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
        $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Start Docker
    systemctl enable docker
    systemctl start docker
    
    log_info "Docker installation complete"
}

check_docker_compose() {
    if docker compose version &>/dev/null; then
        log_info "Docker Compose (plugin) is installed: $(docker compose version)"
        return 0
    elif command -v docker-compose &>/dev/null; then
        log_info "Docker Compose (standalone) is installed: $(docker-compose --version)"
        return 0
    else
        log_info "Docker Compose is not installed"
        return 1
    fi
}

install_docker_compose_debian() {
    log_step "Installing Docker Compose..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would install Docker Compose"
        return 0
    fi
    
    # Docker Compose v2 is included in docker-compose-plugin
    # If standalone is needed:
    local compose_version
    compose_version="v2.24.0"
    
    curl -L "https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    
    chmod +x /usr/local/bin/docker-compose
    
    log_info "Docker Compose installation complete"
}

ensure_docker() {
    local os
    os=$(detect_os)
    
    if ! check_docker; then
        case "$os" in
            ubuntu|debian)
                if [[ "$DRY_RUN" == true ]]; then
                    log_dry "Would install Docker on $os"
                else
                    if [[ $EUID -ne 0 ]]; then
                        log_error "Docker installation requires root. Run with sudo."
                        exit 1
                    fi
                    install_docker_debian
                fi
                ;;
            *)
                log_error "Unsupported OS for automatic Docker installation: $os"
                log_error "Please install Docker manually: https://docs.docker.com/engine/install/"
                exit 1
                ;;
        esac
    fi
    
    if ! check_docker_compose; then
        case "$os" in
            ubuntu|debian)
                if [[ "$DRY_RUN" == true ]]; then
                    log_dry "Would install Docker Compose on $os"
                else
                    if [[ $EUID -ne 0 ]]; then
                        log_error "Docker Compose installation requires root. Run with sudo."
                        exit 1
                    fi
                    install_docker_compose_debian
                fi
                ;;
            *)
                log_error "Unsupported OS for automatic Docker Compose installation: $os"
                log_error "Please install Docker Compose manually: https://docs.docker.com/compose/install/"
                exit 1
                ;;
        esac
    fi
}

# =============================================================================
# Directory Setup
# =============================================================================

create_directories() {
    log_step "Creating required directories..."
    
    for dir in "${REQUIRED_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            log_info "Directory exists: $dir"
        else
            if [[ "$DRY_RUN" == true ]]; then
                log_dry "Would create directory: $dir"
            else
                mkdir -p "$dir"
                log_info "Created directory: $dir"
            fi
        fi
    done
}

# =============================================================================
# Environment Setup
# =============================================================================

setup_env_file() {
    local env_file="${SCRIPT_DIR}/.env"
    local env_example="${SCRIPT_DIR}/web/.env.example"
    local env_prod_example="${SCRIPT_DIR}/.env.production.example"
    
    if [[ -f "$env_file" ]]; then
        log_info ".env file already exists"
        return 0
    fi
    
    # Try .env.production.example first, then fall back to web/.env.example
    if [[ -f "$env_prod_example" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            log_dry "Would copy $env_prod_example to $env_file"
        else
            cp "$env_prod_example" "$env_file"
            log_info "Created .env from .env.production.example"
        fi
    elif [[ -f "$env_example" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            log_dry "Would copy $env_example to $env_file"
        else
            cp "$env_example" "$env_file"
            log_warn "Created .env from web/.env.example (please review for production settings)"
        fi
    else
        log_error "No .env.example file found. Please create .env manually."
        return 1
    fi
}

validate_env() {
    local env_file="${SCRIPT_DIR}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        log_error ".env file not found"
        return 1
    fi
    
    # Source the environment
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a
    
    # Check critical variables (warn only, don't fail)
    local required_vars=(
        "DATABASE_URL"
        "REDIS_URL"
    )
    
    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_warn "Missing environment variables: ${missing_vars[*]}"
        log_warn "Some features may not work correctly"
    fi
    
    log_info "Environment file validated"
}

# =============================================================================
# Docker Compose Operations
# =============================================================================

select_compose_file() {
    if [[ "$IP_ONLY" == true ]]; then
        # IP-only mode: use dev compose file (no SSL)
        if [[ -f "$COMPOSE_DEV" ]]; then
            COMPOSE_FILE="$COMPOSE_DEV"
            log_info "Using development compose file (IP-only mode)"
        else
            log_error "docker-compose.yml not found"
            return 1
        fi
    else
        # Production mode: prefer prod compose file
        if [[ -f "$COMPOSE_PROD" ]]; then
            COMPOSE_FILE="$COMPOSE_PROD"
            log_info "Using production compose file"
        elif [[ -f "$COMPOSE_DEV" ]]; then
            COMPOSE_FILE="$COMPOSE_DEV"
            log_warn "docker-compose.prod.yml not found, using docker-compose.yml"
        else
            log_error "No compose file found"
            return 1
        fi
    fi
}

docker_compose_cmd() {
    if docker compose version &>/dev/null; then
        docker compose -f "$COMPOSE_FILE" "$@"
    elif command -v docker-compose &>/dev/null; then
        docker-compose -f "$COMPOSE_FILE" "$@"
    else
        log_error "Docker Compose not available"
        return 1
    fi
}

pull_images() {
    log_step "Pulling Docker images..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would pull images from $COMPOSE_FILE"
        return 0
    fi
    
    docker_compose_cmd pull
    log_info "Images pulled successfully"
}

save_container_state() {
    if [[ "$DRY_RUN" == true ]] || [[ "$FORCE_CLEAN" == true ]]; then
        return 0
    fi
    
    PREVIOUS_CONTAINERS=$(docker_compose_cmd ps -q 2>/dev/null || echo "")
    if [[ -n "$PREVIOUS_CONTAINERS" ]]; then
        ROLLBACK_NEEDED=true
        log_info "Saved container state for potential rollback"
    fi
}

force_clean() {
    if [[ "$FORCE_CLEAN" != true ]]; then
        return 0
    fi
    
    log_step "Force clean: removing existing containers and volumes..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would remove containers and volumes"
        return 0
    fi
    
    # Stop and remove containers
    docker_compose_cmd down --remove-orphans 2>/dev/null || true
    
    # Remove volumes
    docker_compose_cmd down -v --remove-orphans 2>/dev/null || true
    
    # Remove any orphaned volumes with hippocampus prefix
    docker volume ls -q | grep hippocampus | xargs -r docker volume rm 2>/dev/null || true
    
    log_info "Clean completed"
}

start_services() {
    log_step "Starting services..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would start services with $COMPOSE_FILE"
        return 0
    fi
    
    # Build if needed (for local images)
    docker_compose_cmd build --no-cache 2>/dev/null || docker_compose_cmd build
    
    # Start services
    docker_compose_cmd up -d --remove-orphans
    
    log_info "Services started"
}

# =============================================================================
# Health Checks
# =============================================================================

wait_for_service() {
    local service="$1"
    local max_attempts=$((HEALTH_TIMEOUT / HEALTH_INTERVAL))
    local attempt=0
    
    log_info "Waiting for $service to become healthy..."
    
    while [[ $attempt -lt $max_attempts ]]; do
        local status
        status=$(docker_compose_cmd ps --status running --format json 2>/dev/null | \
            grep -o "\"${service}.*\"health.*\"" | \
            grep -o '"health":"[^"]*"' | \
            cut -d'"' -f4 || echo "unknown")
        
        # Alternative check using docker inspect
        if [[ -z "$status" ]] || [[ "$status" == "unknown" ]]; then
            local container_id
            container_id=$(docker_compose_cmd ps -q "$service" 2>/dev/null | head -1)
            if [[ -n "$container_id" ]]; then
                status=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "running")
            fi
        fi
        
        case "$status" in
            healthy)
                log_info "$service is healthy"
                return 0
                ;;
            running)
                # Service is running but no health check defined
                log_info "$service is running (no health check)"
                return 0
                ;;
            unhealthy)
                log_error "$service is unhealthy"
                return 1
                ;;
            starting)
                : # Continue waiting
                ;;
        esac
        
        sleep "$HEALTH_INTERVAL"
        ((attempt++))
    done
    
    log_error "$service did not become healthy within ${HEALTH_TIMEOUT}s"
    return 1
}

wait_for_all_services() {
    log_step "Waiting for all services to become healthy..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would wait for services to become healthy"
        return 0
    fi
    
    # Get list of services
    local services
    services=$(docker_compose_cmd config --services 2>/dev/null)
    
    local failed_services=()
    
    for service in $services; do
        # Skip init containers that complete and exit
        if [[ "$service" == *"init"* ]] || [[ "$service" == *"setup"* ]]; then
            log_info "Skipping health check for init service: $service"
            continue
        fi
        
        if ! wait_for_service "$service"; then
            failed_services+=("$service")
        fi
    done
    
    if [[ ${#failed_services[@]} -gt 0 ]]; then
        log_error "Failed services: ${failed_services[*]}"
        return 1
    fi
    
    log_info "All services are healthy"
}

# =============================================================================
# SSL Setup
# =============================================================================

SSL_SETUP_SUCCESS=false

get_vps_ip() {
    # Try multiple methods to get the public IP
    local ip
    
    # Try to get from network interface
    ip=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
    
    # Fallback to external services
    if [[ -z "$ip" ]]; then
        ip=$(curl -s -4 https://ifconfig.me 2>/dev/null || \
             curl -s -4 https://api.ipify.org 2>/dev/null || \
             curl -s -4 https://icanhazip.com 2>/dev/null)
    fi
    
    echo "$ip"
}

check_dns_propagation() {
    local domain="$1"
    local expected_ip="$2"
    local max_wait=300  # 5 minutes
    local interval=10   # Check every 10 seconds
    local elapsed=0
    
    log_step "Checking DNS propagation for $domain..."
    log_info "Expected IP: $expected_ip"
    log_info "Maximum wait time: 5 minutes"
    
    while [[ $elapsed -lt $max_wait ]]; do
        local resolved_ip
        
        # Try dig first, fallback to nslookup
        if command -v dig &>/dev/null; then
            resolved_ip=$(dig +short "$domain" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
        elif command -v nslookup &>/dev/null; then
            resolved_ip=$(nslookup "$domain" 2>/dev/null | grep -E 'Address:\s+[0-9]+\.' | tail -1 | awk '{print $2}')
        else
            log_warn "Neither dig nor nslookup available, skipping DNS check"
            return 0
        fi
        
        if [[ -n "$resolved_ip" ]]; then
            log_info "DNS resolved: $domain -> $resolved_ip"
            
            if [[ "$resolved_ip" == "$expected_ip" ]]; then
                log_info "DNS propagation complete! Domain points to this VPS."
                return 0
            else
                log_warn "Domain points to $resolved_ip, expected $expected_ip"
            fi
        else
            log_warn "Domain does not resolve yet (waited ${elapsed}s)"
        fi
        
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done
    
    log_error "DNS propagation timeout after ${max_wait}s"
    log_error "Please ensure $domain points to $expected_ip"
    return 1
}

verify_https_endpoint() {
    local domain="$1"
    local max_attempts=6
    local interval=5
    
    log_step "Verifying HTTPS endpoint..."
    
    for ((i=1; i<=max_attempts; i++)); do
        if curl -sSf --max-time 10 "https://${domain}" -o /dev/null 2>/dev/null; then
            log_info "HTTPS endpoint is accessible"
            return 0
        fi
        
        if [[ $i -lt $max_attempts ]]; then
            log_warn "HTTPS check failed (attempt $i/$max_attempts), retrying in ${interval}s..."
            sleep "$interval"
        fi
    done
    
    log_warn "HTTPS endpoint verification failed (nginx may need restart)"
    return 1
}

setup_ssl() {
    # Skip SSL if --ip-only flag is set
    if [[ "$IP_ONLY" == true ]]; then
        log_info "Skipping SSL setup (--ip-only flag is set)"
        return 0
    fi
    
    # Load DOMAIN from .env if not already set
    if [[ -z "${DOMAIN:-}" ]]; then
        local env_file="${SCRIPT_DIR}/.env"
        if [[ -f "$env_file" ]]; then
            # Extract DOMAIN from .env (handle comments and quotes)
            DOMAIN=$(grep -E '^DOMAIN=' "$env_file" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'" | head -1)
        fi
    fi
    
    # Skip SSL if DOMAIN is not set or empty
    if [[ -z "${DOMAIN:-}" ]]; then
        log_info "Skipping SSL setup (DOMAIN not set)"
        log_info "To enable SSL, set DOMAIN in .env and re-run deployment"
        return 0
    fi
    
    log_step "Setting up SSL for domain: $DOMAIN"
    
    # Get VPS IP
    local vps_ip
    vps_ip=$(get_vps_ip)
    
    if [[ -z "$vps_ip" ]]; then
        log_warn "Could not determine VPS IP, proceeding without DNS check"
    else
        log_info "VPS IP: $vps_ip"
        
        # Check DNS propagation (max 5 minutes)
        if ! check_dns_propagation "$DOMAIN" "$vps_ip"; then
            log_warn "DNS not yet pointing to this VPS"
            log_warn "SSL setup requires domain to resolve to this server's IP"
            log_warn "Continuing with HTTP-only mode. SSL can be set up later when DNS is ready."
            return 0
        fi
    fi
    
    # Check if ssl-renew.sh exists
    local ssl_script="${SCRIPT_DIR}/scripts/ssl-renew.sh"
    if [[ ! -f "$ssl_script" ]]; then
        log_warn "SSL script not found: $ssl_script"
        log_warn "Continuing with HTTP-only mode"
        return 0
    fi
    
    # Check if EMAIL is set (required for Let's Encrypt)
    local email="${EMAIL:-}"
    if [[ -z "$email" ]]; then
        local env_file="${SCRIPT_DIR}/.env"
        if [[ -f "$env_file" ]]; then
            email=$(grep -E '^EMAIL=' "$env_file" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'" | head -1)
        fi
    fi
    
    if [[ -z "$email" ]]; then
        log_warn "EMAIL not set (required for Let's Encrypt registration)"
        log_warn "Continuing with HTTP-only mode. Set EMAIL in .env to enable SSL."
        return 0
    fi
    
    # Run ssl-renew.sh
    log_step "Requesting SSL certificate from Let's Encrypt..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would run: $ssl_script --domain $DOMAIN --email $email"
        SSL_SETUP_SUCCESS=true
        return 0
    fi
    
    # Execute SSL script
    if DOMAIN="$DOMAIN" EMAIL="$email" "$ssl_script" --domain "$DOMAIN" --email "$email"; then
        log_info "SSL certificate obtained successfully"
        SSL_SETUP_SUCCESS=true
        
        # Verify HTTPS endpoint
        if verify_https_endpoint "$DOMAIN"; then
            log_info "HTTPS is working correctly"
        else
            log_warn "Certificate obtained but HTTPS verification failed"
            log_warn "Nginx may need to be restarted to load the new certificate"
        fi
    else
        log_warn "SSL certificate request failed"
        log_warn "Continuing with HTTP-only mode (services remain running)"
        SSL_SETUP_SUCCESS=false
    fi
}

# =============================================================================
# Rollback
# =============================================================================

rollback() {
    log_error "Deployment failed, initiating rollback..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_dry "Would rollback to previous state"
        return 0
    fi
    
    # Stop current containers
    docker_compose_cmd down --remove-orphans 2>/dev/null || true
    
    # If we had previous containers, try to restore them
    if [[ -n "$PREVIOUS_CONTAINERS" ]] && [[ "$ROLLBACK_NEEDED" == true ]]; then
        log_info "Attempting to restore previous containers..."
        # This is a best-effort rollback
        # In practice, you might need to restart from a known good state
        docker_compose_cmd up -d 2>/dev/null || true
    fi
    
    log_error "Rollback completed. Please check logs and fix the issue."
}

# =============================================================================
# Status Reporting
# =============================================================================

show_status() {
    log_step "Deployment Status"

    echo ""
    echo "=========================================="
    echo "  Hippocampus Deployment Complete"
    echo "=========================================="
    echo ""

    if [[ "$IP_ONLY" == true ]]; then
        echo "Mode: IP-only (HTTP only)"
    elif [[ "$SSL_SETUP_SUCCESS" == true ]]; then
        echo "Mode: Production (HTTPS enabled)"
    elif [[ -n "${DOMAIN:-}" ]]; then
        echo "Mode: Production (HTTP only - SSL setup failed or skipped)"
    else
        echo "Mode: Production (HTTP only - no domain configured)"
    fi

    echo ""
    echo "Services:"
    docker_compose_cmd ps

    echo ""
    echo "Access Points:"

    if [[ "$SSL_SETUP_SUCCESS" == true ]] && [[ -n "${DOMAIN:-}" ]]; then
        echo "  Web Application: https://${DOMAIN} (HTTPS)"
        echo "                   http://${DOMAIN}  (HTTP, redirects to HTTPS)"
    elif [[ -n "${DOMAIN:-}" ]]; then
        echo "  Web Application: http://${DOMAIN} (HTTP)"
    else
        echo "  Web Application: http://localhost:3000"
    fi

    echo "  MinIO Console:   http://localhost:9001"
    echo "  PostgreSQL:      localhost:5432"
    echo "  Redis:           localhost:6379"

    if [[ "$SSL_SETUP_SUCCESS" == false ]] && [[ -n "${DOMAIN:-}" ]] && [[ "$IP_ONLY" != true ]]; then
        echo ""
        echo "SSL Notes:"
        echo "  To retry SSL setup: DOMAIN=yourdomain.com EMAIL=admin@example.com ./deploy.sh"
        echo "  To use without SSL: ./deploy.sh --ip-only"
    fi

    echo ""
    echo "Logs: $LOG_FILE"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
    log_init
    parse_args "$@"
    
    log_info "=========================================="
    log_info "Hippocampus Deployment Starting"
    log_info "=========================================="
    log_info "Dry Run: $DRY_RUN"
    log_info "Force Clean: $FORCE_CLEAN"
    log_info "IP Only: $IP_ONLY"
    
    # Acquire lock (skip in dry-run)
    if [[ "$DRY_RUN" != true ]]; then
        check_lock
    fi
    
    # Step 1: Ensure Docker is installed
    log_step "Checking Docker installation..."
    ensure_docker
    
    # Step 2: Select compose file
    if ! select_compose_file; then
        exit 1
    fi
    
    # Step 3: Create directories
    create_directories
    
    # Step 4: Setup environment
    setup_env_file
    validate_env
    
    # Step 5: Save state for rollback
    save_container_state
    
    # Step 6: Force clean if requested
    force_clean
    
    # Step 7: Pull images
    pull_images
    
    # Step 8: Start services
    if ! start_services; then
        rollback
        exit 1
    fi
    
    # Step 9: Wait for health
    if ! wait_for_all_services; then
        rollback
        exit 1
    fi
    
    # Step 10: Setup SSL (after services are healthy)
    setup_ssl
    
    # Success!
    ROLLBACK_NEEDED=false
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "Dry run completed successfully. No changes were made."
    else
        show_status
        log_info "Deployment completed successfully"
    fi
    
    exit 0
}

# Run main
main "$@"
