#!/usr/bin/env bash
#
# SSL Certificate Automation Script
# Let's Encrypt certificate management with automatic renewal
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CERTBOT_DATA="$PROJECT_DIR/data/certbot"
CERTBOT_ETC="$CERTBOT_DATA/etc/letsencrypt"
CERTBOT_LOG="$CERTBOT_DATA/log"
CERTBOT_WWW="$CERTBOT_DATA/www"
MONITOR_SCRIPT="$SCRIPT_DIR/monitor.sh"

# Default values
DRY_RUN=false
SHOW_CRON=false
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print functions
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Display usage information
usage() {
    cat << EOF
SSL Certificate Automation Script

Usage: $(basename "$0") [OPTIONS]

Options:
    --dry-run       Test with Let's Encrypt staging server (no real certs issued)
    --show-cron     Display cron job syntax for automatic renewal
    --domain DOMAIN Specify domain (or set DOMAIN env var)
    --email EMAIL   Specify email (or set EMAIL env var)
    -h, --help      Show this help message

Environment Variables:
    DOMAIN          Domain name for certificate
    EMAIL           Email address for Let's Encrypt registration

Examples:
    # Test certificate issuance (staging server)
    $(basename "$0") --dry-run --domain example.com --email admin@example.com

    # Request real certificate
    $(basename "$0") --domain example.com --email admin@example.com

    # Show cron job syntax
    $(basename "$0") --show-cron
EOF
}

# Show cron job syntax
show_cron_syntax() {
    cat << 'EOF'
=== Cron Job for Automatic SSL Renewal ===

Add the following line to your crontab (crontab -e):

# Run SSL renewal check twice daily (recommended by Let's Encrypt)
0 3,15 * * * /bin/bash /path/to/scripts/ssl-renew.sh >> /var/log/ssl-renew.log 2>&1

Or use this systemd timer alternative:

--- /etc/systemd/system/ssl-renew.service ---
[Unit]
Description=Renew SSL certificates

[Service]
Type=oneshot
ExecStart=/path/to/scripts/ssl-renew.sh

--- /etc/systemd/system/ssl-renew.timer ---
[Unit]
Description=Run SSL renewal twice daily

[Timer]
OnCalendar=*-*-* 03:00,15:00
Persistent=true

[Install]
WantedBy=timers.target

Enable with: systemctl enable --now ssl-renew.timer

EOF
}

# Send notification on failure
notify_failure() {
    local message="$1"
    error "$message"
    
    # Call monitor.sh if available
    if [[ -x "$MONITOR_SCRIPT" ]]; then
        info "Calling monitor.sh for failure notification..."
        "$MONITOR_SCRIPT" --alert "SSL Renewal Failed" "$message" || true
    fi
}

# Reload nginx configuration
reload_nginx() {
    info "Reloading nginx configuration..."
    
    # Check if nginx is running
    if pgrep nginx > /dev/null 2>&1; then
        # Try different nginx reload methods
        if systemctl reload nginx 2>/dev/null || \
           service nginx reload 2>/dev/null || \
           nginx -s reload 2>/dev/null; then
            info "Nginx reloaded successfully"
            return 0
        else
            warn "Failed to reload nginx automatically. Please reload manually: nginx -s reload"
            return 1
        fi
    else
        warn "Nginx not running. Start nginx after placing certificates."
        return 1
    fi
}

# Check Let's Encrypt rate limits
check_rate_limits() {
    local domain="$1"
    local cert_dir="$CERTBOT_ETC/live/$domain"
    
    # Check if we've requested recently
    if [[ -f "$cert_dir/fullchain.pem" ]]; then
        local last_request
        last_request=$(stat -c %Y "$cert_dir/fullchain.pem" 2>/dev/null || stat -f %m "$cert_dir/fullchain.pem" 2>/dev/null || echo "0")
        local now
        now=$(date +%s)
        local days_since=$(( (now - last_request) / 86400 ))
        
        if [[ $days_since -lt 7 ]]; then
            warn "Certificate for $domain was requested $days_since days ago"
            warn "Let's Encrypt rate limit: 5 duplicate certificates per week per domain"
            warn "Consider using --dry-run for testing"
            
            # Check for recent failures
            if [[ -f "$CERTBOT_DATA/.last_failure" ]]; then
                local last_failure
                last_failure=$(cat "$CERTBOT_DATA/.last_failure")
                if [[ $((now - last_failure)) -lt 3600 ]]; then
                    error "Recent failure detected within the last hour. Please wait before retrying."
                    return 1
                fi
            fi
        fi
    fi
    
    return 0
}

# Record failure timestamp
record_failure() {
    date +%s > "$CERTBOT_DATA/.last_failure"
}

# Remove failure timestamp on success
clear_failure() {
    rm -f "$CERTBOT_DATA/.last_failure"
}

# Request or renew certificate
request_certificate() {
    local domain="$1"
    local email="$2"
    local dry_run="$3"
    
    info "Requesting certificate for: $domain"
    info "Email: $email"
    
    if [[ "$dry_run" == "true" ]]; then
        info "=== DRY RUN MODE ==="
        info "Using Let's Encrypt staging server (test certificates only)"
    fi
    
    # Create directories
    mkdir -p "$CERTBOT_ETC" "$CERTBOT_LOG" "$CERTBOT_WWW"
    
    # Build certbot command
    local certbot_args=(
        "certonly"
        "--standalone"
        "--agree-tos"
        "--non-interactive"
        "--keep-until-expiring"
        "--email" "$email"
        "--cert-name" "$domain"
        "-d" "$domain"
        "--config-dir" "$CERTBOT_ETC"
        "--logs-dir" "$CERTBOT_LOG"
        "--work-dir" "$CERTBOT_DATA"
        "--webroot-path" "$CERTBOT_WWW"
    )
    
    # Add staging flag for dry-run
    if [[ "$dry_run" == "true" ]]; then
        certbot_args+=("--test-cert")
    fi
    
    # Run certbot
    info "Running certbot with standalone mode..."
    if certbot "${certbot_args[@]}"; then
        info "Certificate request successful!"
        
        local cert_path="$CERTBOT_ETC/live/$domain/fullchain.pem"
        local key_path="$CERTBOT_ETC/live/$domain/privkey.pem"
        
        info "Certificate location: $cert_path"
        info "Private key location: $key_path"
        
        # Display certificate info
        if [[ -f "$cert_path" ]]; then
            info "Certificate details:"
            openssl x509 -in "$cert_path" -noout -subject -dates -issuer 2>/dev/null || true
        fi
        
        # Only reload nginx for real certificates
        if [[ "$dry_run" == "false" ]]; then
            reload_nginx
            clear_failure
        else
            info "Dry run complete. Real certificates were NOT issued."
            info "Run without --dry-run to obtain real certificates."
        fi
        
        return 0
    else
        record_failure
        notify_failure "Certificate request failed for $domain"
        return 1
    fi
}

# Main function
main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --show-cron)
                SHOW_CRON=true
                shift
                ;;
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                EMAIL="$2"
                shift 2
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
    if [[ "$SHOW_CRON" == "true" ]]; then
        show_cron_syntax
        exit 0
    fi
    
    # Validate required parameters
    if [[ -z "$DOMAIN" ]]; then
        error "Domain is required. Use --domain or set DOMAIN env var."
        usage
        exit 1
    fi
    
    if [[ -z "$EMAIL" ]]; then
        error "Email is required. Use --email or set EMAIL env var."
        usage
        exit 1
    fi
    
    # Validate email format
    if [[ ! "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
        error "Invalid email format: $EMAIL"
        exit 1
    fi
    
    # Check dependencies
    if ! command -v certbot &> /dev/null; then
        error "certbot not found. Please install certbot:"
        error "  Ubuntu/Debian: apt-get install certbot"
        error "  CentOS/RHEL: yum install certbot"
        error "  macOS: brew install certbot"
        exit 1
    fi
    
    if ! command -v openssl &> /dev/null; then
        error "openssl not found. Please install openssl."
        exit 1
    fi
    
    # Check rate limits
    if [[ "$DRY_RUN" == "false" ]]; then
        check_rate_limits "$DOMAIN" || exit 1
    fi
    
    # Request certificate
    request_certificate "$DOMAIN" "$EMAIL" "$DRY_RUN"
}

# Run main function
main "$@"
