#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/observe-translation-task.sh [--env dev|prod] [--poll-interval 15] [--duration 0] [--out-dir <dir>] [--task-id <task-id>] [--search <text>]

Examples:
  bash scripts/observe-translation-task.sh --env dev
  bash scripts/observe-translation-task.sh --env dev --task-id trt_123
  bash scripts/observe-translation-task.sh --env prod --search translation-task-stream

What it does:
  1. Starts a full `wrangler tail` session and writes the raw Worker logs to disk.
  2. Periodically snapshots D1 task state for active, failed, and recent translation tasks.
  3. Keeps running until you stop it, unless you pass a non-zero --duration.
  4. Restarts `wrangler tail` automatically if it exits unexpectedly.

Output files:
  worker-tail.jsonl
  worker-tail.stderr.log
  d1-active.jsonl
  d1-failed.jsonl
  d1-recent.jsonl
  d1-single-task.jsonl   (only when --task-id is provided)
  d1-snapshots.stderr.log
  meta.txt
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

json_escape_for_sql() {
  printf "%s" "$1" | sed "s/'/''/g"
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM_API_DIR="$ROOT_DIR/apps/platform-api"

ENV_NAME="dev"
POLL_INTERVAL_SECONDS=15
DURATION_SECONDS=0
OUT_DIR=""
TASK_ID=""
SEARCH_TERM=""
ACTIVE_LIMIT=100
FAILED_LIMIT=100
RECENT_LIMIT=200

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --env|-e)
      ENV_NAME="${2:-}"
      shift 2
      ;;
    --poll-interval|-p)
      POLL_INTERVAL_SECONDS="${2:-}"
      shift 2
      ;;
    --duration|-d)
      DURATION_SECONDS="${2:-}"
      shift 2
      ;;
    --out-dir|-o)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --task-id|-t)
      TASK_ID="${2:-}"
      shift 2
      ;;
    --search|-s)
      SEARCH_TERM="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command jq
require_command npx

case "$ENV_NAME" in
  dev)
    WORKER_NAME="lexio-platform-api"
    DB_NAME="lexio-platform-dev"
    ENV_FLAGS=(--env dev)
    ;;
  prod|production)
    WORKER_NAME="lexio-platform-api"
    DB_NAME="lexio-platform"
    ENV_FLAGS=()
    ;;
  *)
    echo "Unsupported env: $ENV_NAME" >&2
    exit 1
    ;;
esac

if [[ -n "$TASK_ID" && -z "$SEARCH_TERM" ]]; then
  SEARCH_TERM="$TASK_ID"
fi

if ! [[ "$POLL_INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || ! [[ "$DURATION_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "--poll-interval and --duration must be integers" >&2
  exit 1
fi

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
RUN_LABEL="$TIMESTAMP"
if [[ -n "$TASK_ID" ]]; then
  RUN_LABEL="${RUN_LABEL}-${TASK_ID}"
fi
OUT_DIR="${OUT_DIR:-$ROOT_DIR/tmp/translation-observability/$RUN_LABEL}"
mkdir -p "$OUT_DIR"

TAIL_LOG="$OUT_DIR/worker-tail.jsonl"
TAIL_ERR_LOG="$OUT_DIR/worker-tail.stderr.log"
D1_ACTIVE_LOG="$OUT_DIR/d1-active.jsonl"
D1_FAILED_LOG="$OUT_DIR/d1-failed.jsonl"
D1_RECENT_LOG="$OUT_DIR/d1-recent.jsonl"
D1_SINGLE_TASK_LOG="$OUT_DIR/d1-single-task.jsonl"
D1_ERR_LOG="$OUT_DIR/d1-snapshots.stderr.log"
META_LOG="$OUT_DIR/meta.txt"

ACTIVE_SQL="
SELECT
  id,
  status,
  scene,
  owner_tab_id,
  created_at,
  updated_at,
  started_at,
  finished_at,
  canceled_at,
  error_code,
  error_message,
  CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS age_seconds,
  CASE
    WHEN started_at IS NOT NULL THEN CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
    ELSE NULL
  END AS run_seconds
FROM translation_tasks
WHERE status IN ('queued', 'dispatched', 'running')
ORDER BY updated_at DESC
LIMIT $ACTIVE_LIMIT;
"

FAILED_SQL="
SELECT
  id,
  status,
  scene,
  owner_tab_id,
  created_at,
  updated_at,
  started_at,
  finished_at,
  canceled_at,
  error_code,
  error_message
FROM translation_tasks
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT $FAILED_LIMIT;
"

RECENT_SQL="
SELECT
  id,
  status,
  scene,
  owner_tab_id,
  created_at,
  updated_at,
  started_at,
  finished_at,
  canceled_at,
  error_code,
  error_message
FROM translation_tasks
ORDER BY updated_at DESC
LIMIT $RECENT_LIMIT;
"

if [[ -n "$TASK_ID" ]]; then
  ESCAPED_TASK_ID="$(json_escape_for_sql "$TASK_ID")"
  SINGLE_TASK_SQL="
SELECT
  id,
  status,
  scene,
  owner_tab_id,
  created_at,
  updated_at,
  started_at,
  finished_at,
  canceled_at,
  error_code,
  error_message
FROM translation_tasks
WHERE id = '$ESCAPED_TASK_ID'
LIMIT 1;
"
else
  SINGLE_TASK_SQL=""
fi

cat > "$META_LOG" <<EOF
env=$ENV_NAME
worker_name=$WORKER_NAME
database_name=$DB_NAME
poll_interval_seconds=$POLL_INTERVAL_SECONDS
duration_seconds=$DURATION_SECONDS
task_id=$TASK_ID
search_term=$SEARCH_TERM
platform_api_dir=$PLATFORM_API_DIR
started_at=$(date -Iseconds)
worker_tail_log=$TAIL_LOG
d1_active_log=$D1_ACTIVE_LOG
d1_failed_log=$D1_FAILED_LOG
d1_recent_log=$D1_RECENT_LOG
d1_single_task_log=$D1_SINGLE_TASK_LOG
EOF

TAIL_PID=""

log_meta() {
  printf '%s %s\n' "$(date -Iseconds)" "$1" >> "$META_LOG"
}

start_tail() {
  local tail_cmd=(
    npx wrangler tail "$WORKER_NAME"
    "${ENV_FLAGS[@]}"
    --format json
  )

  if [[ -n "$SEARCH_TERM" ]]; then
    tail_cmd+=(--search "$SEARCH_TERM")
  fi

  (
    cd "$PLATFORM_API_DIR"
    "${tail_cmd[@]}"
  ) >> "$TAIL_LOG" 2>> "$TAIL_ERR_LOG" &

  TAIL_PID="$!"
  log_meta "tail_started pid=$TAIL_PID"
}

ensure_tail_running() {
  if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" >/dev/null 2>&1; then
    return
  fi

  log_meta "tail_restarting"
  start_tail
}

cleanup() {
  if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" >/dev/null 2>&1; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
    wait "$TAIL_PID" >/dev/null 2>&1 || true
  fi

  {
    echo "ended_at=$(date -Iseconds)"
    echo "output_dir=$OUT_DIR"
  } >> "$META_LOG"

  echo "Logs saved to: $OUT_DIR"
}

trap cleanup EXIT INT TERM

snapshot_query() {
  local label="$1"
  local sql="$2"
  local output_file="$3"
  local now
  local raw_json

  now="$(date -Iseconds)"

  if raw_json="$(
    cd "$PLATFORM_API_DIR"
    npx wrangler d1 execute "$DB_NAME" "${ENV_FLAGS[@]}" --remote --json --command "$sql"
  )"; then
    printf '%s\n' "$raw_json" \
      | jq -c --arg ts "$now" --arg label "$label" '{ts: $ts, label: $label, result: .}' \
      >> "$output_file"
  else
    jq -cn --arg ts "$now" --arg label "$label" --arg error "d1 snapshot failed" \
      '{ts: $ts, label: $label, error: $error}' \
      >> "$output_file"
  fi
}

snapshot_all() {
  snapshot_query "active" "$ACTIVE_SQL" "$D1_ACTIVE_LOG" 2>> "$D1_ERR_LOG"
  snapshot_query "failed" "$FAILED_SQL" "$D1_FAILED_LOG" 2>> "$D1_ERR_LOG"
  snapshot_query "recent" "$RECENT_SQL" "$D1_RECENT_LOG" 2>> "$D1_ERR_LOG"

  if [[ -n "$SINGLE_TASK_SQL" ]]; then
    snapshot_query "single-task" "$SINGLE_TASK_SQL" "$D1_SINGLE_TASK_LOG" 2>> "$D1_ERR_LOG"
  fi
}

start_tail
snapshot_all

echo "Started platform API observability capture. Output: $OUT_DIR"

if (( DURATION_SECONDS > 0 )); then
  END_AT=$((SECONDS + DURATION_SECONDS))
  while (( SECONDS < END_AT )); do
    sleep "$POLL_INTERVAL_SECONDS"
    ensure_tail_running
    snapshot_all
  done
else
  while true; do
    sleep "$POLL_INTERVAL_SECONDS"
    ensure_tail_running
    snapshot_all
  done
fi
