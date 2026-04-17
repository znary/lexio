# Translation Observability Runbook

## What changed

This repo now has a direct way to keep capturing platform API logs and task state until you stop the process.

- The local managed translation queue timeout is `180_000ms` in [src/entrypoints/background/translation-queues.ts](/Users/liuzhuangm4/develop/english/src/entrypoints/background/translation-queues.ts:26).
- The request queue now aborts the running task when its timeout fires in [src/utils/request/request-queue.ts](/Users/liuzhuangm4/develop/english/src/utils/request/request-queue.ts:141).
- The Cloudflare Queue consumer now uses `max_batch_size = 10` and `max_batch_timeout = 1` second in [apps/platform-api/wrangler.jsonc](/Users/liuzhuangm4/develop/english/apps/platform-api/wrangler.jsonc:23).
- A capture script writes Worker logs and D1 task snapshots to disk: [scripts/observe-translation-task.sh](/Users/liuzhuangm4/develop/english/scripts/observe-translation-task.sh:1).
- Translation task and usage gate logs now carry explicit namespaces:
  - `translation-task`
  - `usage-gate`
  - `translation-task-stream`
  - `usage-gate-queue`

## Quick start

### Full continuous capture

```bash
pnpm run observe:platform-api -- --env dev
```

This keeps running until you stop it with `Ctrl+C`.

### Optional narrowing

If you already know a `taskId` or a log keyword, keep the same script and add a filter:

```bash
pnpm run observe:platform-api -- --env dev --task-id <task-id>
pnpm run observe:platform-api -- --env dev --search translation-task-stream
```

For production:

```bash
pnpm run observe:platform-api -- --env prod
```

The script writes files to `tmp/translation-observability/<timestamp>/` or `tmp/translation-observability/<timestamp>-<task-id>/`.

### Manual commands

Tail the Worker logs:

```bash
cd /Users/liuzhuangm4/develop/english/apps/platform-api
npx wrangler tail lexio-platform-api-dev --env dev --format json --search "<task-id>"
```

To capture all logs, remove `--search`.

Query the D1 row:

```bash
cd /Users/liuzhuangm4/develop/english/apps/platform-api
npx wrangler d1 execute lexio-platform-dev --remote --env dev --json --command "
SELECT id, status, scene, owner_tab_id, created_at, started_at, finished_at, canceled_at, error_code, error_message
FROM translation_tasks
WHERE id = '<task-id>';
"
```

Production uses:

- Worker: `lexio-platform-api`
- D1: `lexio-platform`
- No `--env dev`

## What logs exist

### Translation task state logs

Source:

- [apps/platform-api/src/lib/translation-task-log.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/lib/translation-task-log.ts:1)
- [apps/platform-api/src/routes/translate.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/routes/translate.ts:629)

Key fields:

- `taskId`
- `requestId`
- `status`
- `queuePosition`
- `queueWaitMs`
- `runMs`
- `upstreamStatus`
- `errorCode`
- `errorMessage`

These logs tell you when the task moved from `queued` to `running`, and whether it finished as `completed`, `failed`, or `canceled`.
They now include `namespace: "translation-task"`.

### Usage gate logs

Source:

- [apps/platform-api/src/lib/usage-gate-log.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/lib/usage-gate-log.ts:1)
- [apps/platform-api/src/durable-objects/usage-gate.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/durable-objects/usage-gate.ts:373)

These logs show queue position, queue wait, and release reason inside the Durable Object.
They now include `namespace: "usage-gate"`.

### Stream attachment logs

Source:

- [apps/platform-api/src/routes/translate.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/routes/translate.ts:566)
- [apps/platform-api/src/durable-objects/usage-gate.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/durable-objects/usage-gate.ts:723)

Events:

- `translation-task-stream attach-live`
- `translation-task-stream attach-immediate`
- `translation-task-stream terminal-event-without-subscriber`

These logs tell you whether the client attached to the SSE stream in time, and whether a terminal event was published after the client had already gone away.

### Queue enqueue failure logs

Source:

- [apps/platform-api/src/durable-objects/usage-gate.ts](/Users/liuzhuangm4/develop/english/apps/platform-api/src/durable-objects/usage-gate.ts:804)

Event:

- `usage-gate-queue enqueue-failed`

This was previously silent. If this appears, the task can remain queued in D1 while the browser waits.

## How to read one task

### Case 1: Queue wait is the problem

Signs:

- D1 row stays `queued`
- `started_at` is `null`
- Worker logs show large `queuePosition` or `queueWaitMs`

Meaning:

- The task did not reach execution fast enough.
- Look at Queue consumer settings, traffic spikes, or stuck running tasks.

### Case 2: Upstream model is slow

Signs:

- D1 row becomes `running`
- `started_at` is set quickly
- `finished_at` is much later
- `runMs` is large

Meaning:

- The queue is not the bottleneck.
- The model request itself is slow.

### Case 3: Upstream request failed

Signs:

- D1 row becomes `failed`
- `error_code` is `upstream_4xx`, `upstream_5xx`, or `upstream_error`
- `error_message` contains the upstream message

Meaning:

- The platform reached the model but did not get a valid completion.

### Case 4: Task finished but the browser still showed timeout

Signs:

- D1 row is `completed`
- Worker logs show `terminal-event-without-subscriber`

Meaning:

- The server finished.
- The browser gave up waiting first, or the stream disconnected.

## Output files from the capture script

- `meta.txt`: capture parameters
- `worker-tail.jsonl`: raw `wrangler tail` output
- `worker-tail.stderr.log`: tail command stderr
- `d1-active.jsonl`: active tasks (`queued`, `dispatched`, `running`)
- `d1-failed.jsonl`: recent failed tasks
- `d1-recent.jsonl`: recent task updates across all statuses
- `d1-single-task.jsonl`: optional single-task snapshots when `--task-id` is provided
- `d1-snapshots.stderr.log`: D1 command stderr

The script also restarts `wrangler tail` if it exits unexpectedly.

## Recommended triage flow

1. Start `pnpm run observe:platform-api -- --env dev` before reproducing the problem.
2. Reproduce the slow or failed translation.
3. Open `d1-active.jsonl` and `d1-failed.jsonl` first.
4. Open `worker-tail.jsonl` and search for:
   - `"namespace":"translation-task"`
   - `"namespace":"usage-gate"`
   - `"namespace":"translation-task-stream"`
   - `"namespace":"usage-gate-queue"`
5. If you later learn the `taskId`, rerun the same script with `--task-id <task-id>` to get a narrowed capture directory.

## Known timeout relationship

Before this change, the browser-side managed translation queue used `20_000ms`, while the Cloudflare Queue consumer could wait up to `30` seconds before dispatching a batch. That combination could fail even when the platform was healthy.

The current values are:

- Browser-side managed translation queue timeout: `180_000ms`
- Cloudflare Queue `max_batch_size`: `10`
- Cloudflare Queue `max_batch_timeout`: `1s`

This does not remove all slow translations, but it removes one obvious false-timeout path.
