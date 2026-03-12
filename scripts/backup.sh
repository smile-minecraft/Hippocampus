#!/bin/bash

# =============================================================================
# Hippocampus Backup Script
# Automated backup for PostgreSQL and MinIO
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Base directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/data/backups"
POSTGRES_BACKUP_DIR="${BACKUP_DIR}/postgres"
MINIO_BACKUP_DIR="${BACKUP_DIR}/minio"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Docker container names
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-hippocampus-postgres}"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_BUCKET="${MINIO_BUCKET:-hippocampus-raw}"

# Database configuration
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-hippocampus}"
POSTGRES_TEST_DB="${POSTGRES_TEST_DB:-hippocampus_test}"

# Retention settings
POSTGRES_RETENTION_DAYS=7
MINIO_RETENTION_WEEKS=4

# Monitoring script path
MONITOR_SCRIPT="${SCRIPT_DIR}/monitor.sh"

# =============================================================================
# Colors for output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Logging functions
# =============================================================================

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[${timestamp}] [${level}] ${message}" | tee -a "${LOG_FILE}"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
    log "INFO" "$*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
    log "SUCCESS" "$*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
    log "WARN" "$*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
    log "ERROR" "$*"
}

# =============================================================================
# Error handling
# =============================================================================

notify_failure() {
    local service="$1"
    local error_msg="$2"
    
    log_error "Backup failed for ${service}: ${error_msg}"
    
    # Call monitor.sh if available
    if [[ -x "${MONITOR_SCRIPT}" ]]; then
        log_info "Notifying monitor.sh about backup failure..."
        "${MONITOR_SCRIPT}" backup-failed "${service}" "${error_msg}" 2>/dev/null || true
    fi
}

cleanup() {
    local exit_code=$?
    if [[ ${exit_code} -ne 0 ]]; then
        log_error "Backup script exited with error code ${exit_code}"
    fi
}

trap cleanup EXIT

# =============================================================================
# Utility functions
# =============================================================================

ensure_directories() {
    mkdir -p "${POSTGRES_BACKUP_DIR}" "${MINIO_BACKUP_DIR}"
}

get_timestamp() {
    date '+%Y%m%d-%H%M%S'
}

# =============================================================================
# PostgreSQL Backup
# =============================================================================

backup_postgres() {
    local dry_run="${1:-false}"
    local timestamp
    timestamp=$(get_timestamp)
    local backup_file="${POSTGRES_BACKUP_DIR}/hippocampus-${timestamp}.sql.gz"
    
    log_info "Starting PostgreSQL backup..."
    
    if [[ "${dry_run}" == "true" ]]; then
        log_info "[DRY-RUN] Would create backup: ${backup_file}"
        log_info "[DRY-RUN] Command: docker exec ${POSTGRES_CONTAINER} pg_dump -U ${POSTGRES_USER} -d ${POSTGRES_DB} --format=custom | gzip > ${backup_file}"
        return 0
    fi
    
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
        notify_failure "postgres" "Container ${POSTGRES_CONTAINER} is not running"
        return 1
    fi
    
    log_info "Creating PostgreSQL backup: ${backup_file}"
    
    if docker exec "${POSTGRES_CONTAINER}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom | gzip > "${backup_file}"; then
        local file_size
        file_size=$(du -h "${backup_file}" | cut -f1)
        log_success "PostgreSQL backup completed: ${backup_file} (${file_size})"
        
        # Verify the backup was created and has content
        if [[ ! -s "${backup_file}" ]]; then
            notify_failure "postgres" "Backup file is empty"
            rm -f "${backup_file}"
            return 1
        fi
        
        return 0
    else
        notify_failure "postgres" "pg_dump command failed"
        rm -f "${backup_file}"
        return 1
    fi
}

# =============================================================================
# MinIO Backup
# =============================================================================

backup_minio() {
    local dry_run="${1:-false}"
    local timestamp
    timestamp=$(get_timestamp)
    local backup_file="${MINIO_BACKUP_DIR}/minio-${timestamp}.tar.gz"
    local temp_dir="${MINIO_BACKUP_DIR}/.temp-${timestamp}"
    
    log_info "Starting MinIO backup..."
    
    if [[ "${dry_run}" == "true" ]]; then
        log_info "[DRY-RUN] Would create backup: ${backup_file}"
        log_info "[DRY-RUN] Command: mc mirror ${MINIO_ALIAS}/${MINIO_BUCKET} ${temp_dir}/"
        log_info "[DRY-RUN] Command: tar -czf ${backup_file} -C ${temp_dir} ."
        return 0
    fi
    
    # Check if mc is available
    if ! command -v mc &>/dev/null; then
        notify_failure "minio" "MinIO client (mc) not found in PATH"
        return 1
    fi
    
    log_info "Creating MinIO backup: ${backup_file}"
    
    # Create temp directory
    mkdir -p "${temp_dir}"
    
    # Perform mirror backup
    if mc mirror "${MINIO_ALIAS}/${MINIO_BUCKET}" "${temp_dir}/"; then
        log_info "MinIO mirror completed, creating archive..."
        
        # Create compressed archive
        if tar -czf "${backup_file}" -C "${temp_dir}" .; then
            local file_size
            file_size=$(du -h "${backup_file}" | cut -f1)
            log_success "MinIO backup completed: ${backup_file} (${file_size})"
            
            # Verify the backup
            if [[ ! -s "${backup_file}" ]]; then
                notify_failure "minio" "Backup file is empty"
                rm -f "${backup_file}"
                rm -rf "${temp_dir}"
                return 1
            fi
            
            # Cleanup temp directory
            rm -rf "${temp_dir}"
            return 0
        else
            notify_failure "minio" "Failed to create archive"
            rm -rf "${temp_dir}"
            return 1
        fi
    else
        notify_failure "minio" "mc mirror command failed"
        rm -rf "${temp_dir}"
        return 1
    fi
}

# =============================================================================
# Retention Policy
# =============================================================================

apply_retention_policy() {
    local dry_run="${1:-false}"
    
    log_info "Applying retention policy..."
    
    # PostgreSQL: Keep last 7 days
    if [[ -d "${POSTGRES_BACKUP_DIR}" ]]; then
        local postgres_count
        postgres_count=$(find "${POSTGRES_BACKUP_DIR}" -name "hippocampus-*.sql.gz" -type f | wc -l)
        log_info "Found ${postgres_count} PostgreSQL backup(s)"
        
        if [[ "${dry_run}" == "true" ]]; then
            log_info "[DRY-RUN] Would delete PostgreSQL backups older than ${POSTGRES_RETENTION_DAYS} days"
            find "${POSTGRES_BACKUP_DIR}" -name "hippocampus-*.sql.gz" -type f -mtime +${POSTGRES_RETENTION_DAYS} -exec echo "[DRY-RUN] Would delete: {}" \; 2>/dev/null || true
        else
            local deleted_count=0
            while IFS= read -r file; do
                if [[ -n "${file}" ]]; then
                    log_info "Deleting old PostgreSQL backup: ${file}"
                    rm -f "${file}"
                    ((deleted_count++)) || true
                fi
            done < <(find "${POSTGRES_BACKUP_DIR}" -name "hippocampus-*.sql.gz" -type f -mtime +${POSTGRES_RETENTION_DAYS} 2>/dev/null)
            
            if [[ ${deleted_count} -gt 0 ]]; then
                log_success "Deleted ${deleted_count} old PostgreSQL backup(s)"
            else
                log_info "No old PostgreSQL backups to delete"
            fi
        fi
    fi
    
    # MinIO: Keep last 4 weeks (28 days)
    if [[ -d "${MINIO_BACKUP_DIR}" ]]; then
        local minio_count
        minio_count=$(find "${MINIO_BACKUP_DIR}" -name "minio-*.tar.gz" -type f | wc -l)
        log_info "Found ${minio_count} MinIO backup(s)"
        
        local retention_days=$((MINIO_RETENTION_WEEKS * 7))
        
        if [[ "${dry_run}" == "true" ]]; then
            log_info "[DRY-RUN] Would delete MinIO backups older than ${MINIO_RETENTION_WEEKS} weeks (${retention_days} days)"
            find "${MINIO_BACKUP_DIR}" -name "minio-*.tar.gz" -type f -mtime +${retention_days} -exec echo "[DRY-RUN] Would delete: {}" \; 2>/dev/null || true
        else
            local deleted_count=0
            while IFS= read -r file; do
                if [[ -n "${file}" ]]; then
                    log_info "Deleting old MinIO backup: ${file}"
                    rm -f "${file}"
                    ((deleted_count++)) || true
                fi
            done < <(find "${MINIO_BACKUP_DIR}" -name "minio-*.tar.gz" -type f -mtime +${retention_days} 2>/dev/null)
            
            if [[ ${deleted_count} -gt 0 ]]; then
                log_success "Deleted ${deleted_count} old MinIO backup(s)"
            else
                log_info "No old MinIO backups to delete"
            fi
        fi
    fi
}

# =============================================================================
# Backup Verification
# =============================================================================

verify_backup() {
    log_info "Verifying last backup integrity..."
    
    local exit_code=0
    
    # Verify PostgreSQL backup
    local latest_pg_backup
    latest_pg_backup=$(find "${POSTGRES_BACKUP_DIR}" -name "hippocampus-*.sql.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    
    if [[ -n "${latest_pg_backup}" ]]; then
        log_info "Found latest PostgreSQL backup: ${latest_pg_backup}"
        
        # Check if file is valid gzip
        if gzip -t "${latest_pg_backup}" 2>/dev/null; then
            log_success "PostgreSQL backup is valid (gzip integrity OK)"
        else
            log_error "PostgreSQL backup is corrupted: ${latest_pg_backup}"
            exit_code=1
        fi
        
        # Check file size
        local file_size
        file_size=$(stat -f%z "${latest_pg_backup}" 2>/dev/null || stat -c%s "${latest_pg_backup}" 2>/dev/null || echo "0")
        if [[ ${file_size} -lt 1024 ]]; then
            log_warn "PostgreSQL backup is suspiciously small: ${file_size} bytes"
        fi
    else
        log_warn "No PostgreSQL backups found for verification"
    fi
    
    # Verify MinIO backup
    local latest_minio_backup
    latest_minio_backup=$(find "${MINIO_BACKUP_DIR}" -name "minio-*.tar.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    
    if [[ -n "${latest_minio_backup}" ]]; then
        log_info "Found latest MinIO backup: ${latest_minio_backup}"
        
        # Check if file is valid tar.gz
        if tar -tzf "${latest_minio_backup}" >/dev/null 2>&1; then
            log_success "MinIO backup is valid (tar.gz integrity OK)"
        else
            log_error "MinIO backup is corrupted: ${latest_minio_backup}"
            exit_code=1
        fi
        
        # Check file size
        local file_size
        file_size=$(stat -f%z "${latest_minio_backup}" 2>/dev/null || stat -c%s "${latest_minio_backup}" 2>/dev/null || echo "0")
        if [[ ${file_size} -lt 1024 ]]; then
            log_warn "MinIO backup is suspiciously small: ${file_size} bytes"
        fi
    else
        log_warn "No MinIO backups found for verification"
    fi
    
    return ${exit_code}
}

# =============================================================================
# Restore Test
# =============================================================================

restore_test() {
    local latest_pg_backup
    latest_pg_backup=$(find "${POSTGRES_BACKUP_DIR}" -name "hippocampus-*.sql.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    
    if [[ -z "${latest_pg_backup}" ]]; then
        log_error "No PostgreSQL backup found for restore test"
        return 1
    fi
    
    log_info "Testing restore from: ${latest_pg_backup}"
    log_info "Target database: ${POSTGRES_TEST_DB}"
    
    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
        log_error "Container ${POSTGRES_CONTAINER} is not running"
        return 1
    fi
    
    # Drop and recreate test database
    log_info "Dropping test database if exists..."
    docker exec "${POSTGRES_CONTAINER}" dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_TEST_DB}" 2>/dev/null || true
    
    log_info "Creating test database..."
    if ! docker exec "${POSTGRES_CONTAINER}" createdb -U "${POSTGRES_USER}" "${POSTGRES_TEST_DB}"; then
        log_error "Failed to create test database"
        return 1
    fi
    
    # Restore the backup
    log_info "Restoring backup to test database..."
    if gzip -dc "${latest_pg_backup}" | docker exec -i "${POSTGRES_CONTAINER}" pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_TEST_DB}" --no-owner --no-privileges 2>/dev/null; then
        log_success "Restore test completed successfully!"
        
        # Verify data exists
        local table_count
        table_count=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER}" -d "${POSTGRES_TEST_DB}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | xargs || echo "0")
        log_info "Test database contains ${table_count} table(s)"
        
        # Cleanup test database
        log_info "Cleaning up test database..."
        docker exec "${POSTGRES_CONTAINER}" dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_TEST_DB}" 2>/dev/null || true
        
        return 0
    else
        log_error "Restore test failed"
        docker exec "${POSTGRES_CONTAINER}" dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_TEST_DB}" 2>/dev/null || true
        return 1
    fi
}

# =============================================================================
# Usage
# =============================================================================

show_usage() {
    cat <<EOF
Hippocampus Backup Script

Usage: $(basename "$0") [OPTIONS] [COMMAND]

Commands:
  postgres          Backup PostgreSQL only
  minio             Backup MinIO only
  (no command)      Backup both PostgreSQL and MinIO

Options:
  --verify          Check integrity of last backup
  --restore-test    Restore last backup to test database (${POSTGRES_TEST_DB})
  --dry-run         Show what would be backed up without executing
  --help            Show this help message

Environment Variables:
  POSTGRES_CONTAINER    Docker container name (default: hippocampus-postgres)
  POSTGRES_USER         PostgreSQL user (default: postgres)
  POSTGRES_DB           PostgreSQL database (default: hippocampus)
  POSTGRES_TEST_DB      Test database name (default: hippocampus_test)
  MINIO_ALIAS           MinIO alias (default: local)
  MINIO_BUCKET          MinIO bucket name (default: hippocampus-raw)

Examples:
  $(basename "$0")                    # Backup both services
  $(basename "$0") postgres           # Backup PostgreSQL only
  $(basename "$0") minio              # Backup MinIO only
  $(basename "$0") --dry-run          # Show what would be backed up
  $(basename "$0") --verify           # Verify last backups
  $(basename "$0") --restore-test     # Test restore to ${POSTGRES_TEST_DB}

Cron Configuration:
  # PostgreSQL: Daily at 3 AM
  0 3 * * * cd /path/to/project && ./scripts/backup.sh postgres

  # MinIO: Weekly on Sunday at 4 AM
  0 4 * * 0 cd /path/to/project && ./scripts/backup.sh minio

Retention Policy:
  - PostgreSQL: Keeps 7 daily backups
  - MinIO: Keeps 4 weekly backups
EOF
}

# =============================================================================
# Main
# =============================================================================

main() {
    local dry_run="false"
    local do_verify="false"
    local do_restore_test="false"
    local backup_postgres="false"
    local backup_minio="false"
    
    # Parse arguments
    for arg in "$@"; do
        case "${arg}" in
            --dry-run)
                dry_run="true"
                ;;
            --verify)
                do_verify="true"
                ;;
            --restore-test)
                do_restore_test="true"
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            postgres)
                backup_postgres="true"
                ;;
            minio)
                backup_minio="true"
                ;;
            *)
                log_error "Unknown option: ${arg}"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Ensure directories exist
    ensure_directories
    
    # Handle verify option
    if [[ "${do_verify}" == "true" ]]; then
        verify_backup
        exit $?
    fi
    
    # Handle restore test option
    if [[ "${do_restore_test}" == "true" ]]; then
        restore_test
        exit $?
    fi
    
    # If no specific backup type specified, backup both
    if [[ "${backup_postgres}" == "false" && "${backup_minio}" == "false" ]]; then
        backup_postgres="true"
        backup_minio="true"
    fi
    
    log_info "Starting backup process..."
    if [[ "${dry_run}" == "true" ]]; then
        log_info "Running in DRY-RUN mode (no actual backups will be created)"
    fi
    
    local exit_code=0
    
    # Backup PostgreSQL
    if [[ "${backup_postgres}" == "true" ]]; then
        if ! backup_postgres "${dry_run}"; then
            exit_code=1
        fi
    fi
    
    # Backup MinIO
    if [[ "${backup_minio}" == "true" ]]; then
        if ! backup_minio "${dry_run}"; then
            exit_code=1
        fi
    fi
    
    # Apply retention policy
    if ! apply_retention_policy "${dry_run}"; then
        exit_code=1
    fi
    
    if [[ ${exit_code} -eq 0 ]]; then
        log_success "Backup process completed successfully"
    else
        log_error "Backup process completed with errors"
    fi
    
    exit ${exit_code}
}

main "$@"
