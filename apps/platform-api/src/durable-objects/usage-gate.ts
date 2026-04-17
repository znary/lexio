import type { Entitlements } from "../lib/env"
import type { UsageGateLane, UsageGateStatus } from "../lib/usage-gate-log"
import { logUsageGateEvent } from "../lib/usage-gate-log"

const ACTIVE_LEASE_TTL_MS = 2 * 60 * 1000
const INTERACTIVE_SLOTS = 2
const BACKGROUND_QUEUE_LIMIT = 100

interface UsageGateEnv {
  USAGE_GATE_BACKGROUND_QUEUE?: {
    send: (message: UsageGateQueueMessage) => Promise<unknown>
  }
}

interface UsageGateQueueMessage {
  taskId: string
  requestId: string
  userId: string
  scene: string | null
  lane: UsageGateLane
  ownerTabId: number | null
}

interface UsageTask {
  taskId: string
  requestId: string
  userId: string
  scene: string | null
  lane: UsageGateLane
  status: UsageGateStatus
  ownerTabId: number | null
  requestKind: string
  concurrentRequestLimit: number
  createdAt: number
  queuedAt: number | null
  startedAt: number | null
  releasedAt: number | null
  canceledAt: number | null
  leaseId: string | null
  cancelReason: string | null
  releaseReason: string | null
  upstreamStatus: number | null
}

interface UsageState {
  monthKey: string
  requestCount: number
  activeCount: number
  interactiveActiveCount: number
  backgroundActiveCount: number
  queueOrder: string[]
  tasks: Record<string, UsageTask>
  leases: Record<string, number>
}

interface CreateTaskRequest {
  userId: string
  requestId?: string
  requestKind: string
  entitlements: Entitlements
  scene?: string | null
  ownerTabId?: number | null
  lane?: UsageGateLane
  taskId?: string
}

interface AssignTaskRequest {
  taskId: string
  requestId?: string
}

interface ReleaseTaskRequest {
  leaseId?: string
  taskId?: string
  releaseReason?: string
  upstreamStatus?: number
  requestId?: string
}

interface CancelTaskRequest {
  taskId: string
  cancelReason?: string
  requestId?: string
}

interface LeaseExpiredRequest {
  leaseId?: string
  taskId?: string
  requestId?: string
}

interface TranslationTaskStreamRequest {
  taskId: string
  snapshot: Record<string, unknown>
}

interface TranslationTaskPublishRequest {
  taskId: string
  event: "queued" | "running" | "completed" | "failed" | "canceled"
  data: Record<string, unknown>
}

function currentMonthKey() {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

function createEmptyState(monthKey = currentMonthKey()): UsageState {
  return {
    monthKey,
    requestCount: 0,
    activeCount: 0,
    interactiveActiveCount: 0,
    backgroundActiveCount: 0,
    queueOrder: [],
    tasks: {},
    leases: {},
  }
}

function normalizeTask(task: Partial<UsageTask> & Pick<UsageTask, "taskId" | "requestId" | "userId" | "requestKind">): UsageTask {
  return {
    taskId: task.taskId,
    requestId: task.requestId,
    userId: task.userId,
    scene: task.scene ?? null,
    lane: task.lane ?? "interactive",
    status: task.status ?? "queued",
    ownerTabId: task.ownerTabId ?? null,
    requestKind: task.requestKind,
    concurrentRequestLimit: Number.isFinite(task.concurrentRequestLimit) ? Number(task.concurrentRequestLimit) : 10,
    createdAt: Number.isFinite(task.createdAt) ? Number(task.createdAt) : Date.now(),
    queuedAt: Number.isFinite(task.queuedAt) ? Number(task.queuedAt) : null,
    startedAt: Number.isFinite(task.startedAt) ? Number(task.startedAt) : null,
    releasedAt: Number.isFinite(task.releasedAt) ? Number(task.releasedAt) : null,
    canceledAt: Number.isFinite(task.canceledAt) ? Number(task.canceledAt) : null,
    leaseId: typeof task.leaseId === "string" ? task.leaseId : null,
    cancelReason: task.cancelReason ?? null,
    releaseReason: task.releaseReason ?? null,
    upstreamStatus: Number.isFinite(task.upstreamStatus) ? Number(task.upstreamStatus) : null,
  }
}

function normalizeState(stored: unknown): UsageState {
  const monthKey = currentMonthKey()
  if (!stored || typeof stored !== "object") {
    return createEmptyState(monthKey)
  }

  const raw = stored as Partial<UsageState> & {
    leases?: Record<string, number>
    tasks?: Record<string, Partial<UsageTask> & Pick<UsageTask, "taskId" | "requestId" | "userId" | "requestKind">>
  }

  if (!raw.tasks) {
    const legacyState = createEmptyState(raw.monthKey ?? monthKey)
    legacyState.requestCount = Number.isFinite(raw.requestCount) ? Number(raw.requestCount) : 0
    for (const [leaseId, startedAt] of Object.entries(raw.leases ?? {})) {
      const taskId = leaseId
      legacyState.tasks[taskId] = normalizeTask({
        taskId,
        requestId: taskId,
        userId: "legacy-user",
        requestKind: "generate",
        concurrentRequestLimit: 10,
        status: "running",
        lane: "interactive",
        createdAt: startedAt,
        startedAt,
        leaseId,
      })
    }
    legacyState.leases = { ...(raw.leases ?? {}) }
    syncState(legacyState)
    return legacyState
  }

  const state: UsageState = {
    monthKey: raw.monthKey ?? monthKey,
    requestCount: Number.isFinite(raw.requestCount) ? Number(raw.requestCount) : 0,
    activeCount: Number.isFinite(raw.activeCount) ? Number(raw.activeCount) : 0,
    interactiveActiveCount: Number.isFinite(raw.interactiveActiveCount) ? Number(raw.interactiveActiveCount) : 0,
    backgroundActiveCount: Number.isFinite(raw.backgroundActiveCount) ? Number(raw.backgroundActiveCount) : 0,
    queueOrder: Array.isArray(raw.queueOrder) ? [...raw.queueOrder] : [],
    tasks: {},
    leases: {},
  }

  for (const [taskId, task] of Object.entries(raw.tasks ?? {})) {
    state.tasks[taskId] = normalizeTask({
      ...task,
      taskId,
      requestId: task.requestId ?? taskId,
      userId: task.userId ?? "unknown",
      requestKind: task.requestKind ?? "generate",
      concurrentRequestLimit: Number.isFinite(task.concurrentRequestLimit) ? Number(task.concurrentRequestLimit) : 10,
    })
  }

  state.leases = Object.fromEntries(
    Object.entries(raw.leases ?? {}).filter(([, startedAt]) => Number.isFinite(startedAt)),
  ) as Record<string, number>

  syncState(state)
  return state
}

function syncState(state: UsageState): void {
  const queueOrder = state.queueOrder.filter(taskId => state.tasks[taskId]?.status === "queued")
  const queuedTaskIds = new Set(queueOrder)
  const nextLeases: Record<string, number> = {}

  for (const task of Object.values(state.tasks)) {
    if (task.status === "queued" && !queuedTaskIds.has(task.taskId)) {
      queueOrder.push(task.taskId)
    }
    else if (task.status !== "queued") {
      const queuedIndex = queueOrder.indexOf(task.taskId)
      if (queuedIndex >= 0) {
        queueOrder.splice(queuedIndex, 1)
      }
    }

    if (task.status === "running" && task.leaseId) {
      nextLeases[task.leaseId] = task.startedAt ?? Date.now()
    }
  }

  state.queueOrder = queueOrder
  state.leases = nextLeases

  let interactiveActiveCount = 0
  let backgroundActiveCount = 0
  for (const task of Object.values(state.tasks)) {
    if (task.status !== "running") {
      continue
    }
    if (task.lane === "background") {
      backgroundActiveCount += 1
    }
    else {
      interactiveActiveCount += 1
    }
  }

  state.interactiveActiveCount = interactiveActiveCount
  state.backgroundActiveCount = backgroundActiveCount
  state.activeCount = interactiveActiveCount + backgroundActiveCount
}

function getTaskQueuePosition(state: UsageState, taskId: string): number | null {
  const index = state.queueOrder.indexOf(taskId)
  return index >= 0 ? index + 1 : null
}

function getBackgroundSlots(limit: number): number {
  return Math.max(1, limit - INTERACTIVE_SLOTS)
}

function getLaneCapacity(state: UsageState, lane: UsageGateLane, entitlements: Entitlements): number {
  return lane === "interactive"
    ? INTERACTIVE_SLOTS
    : getBackgroundSlots(entitlements.concurrentRequestLimit)
}

function getRunningCount(state: UsageState, lane: UsageGateLane): number {
  return lane === "interactive" ? state.interactiveActiveCount : state.backgroundActiveCount
}

function hasRunningCapacity(state: UsageState, lane: UsageGateLane, entitlements: Entitlements): boolean {
  return getRunningCount(state, lane) < getLaneCapacity(state, lane, entitlements)
}

function chooseLane(state: UsageState, preferredLane: UsageGateLane, entitlements: Entitlements): UsageGateLane | null {
  return hasRunningCapacity(state, preferredLane, entitlements) ? preferredLane : null
}

function buildTaskLog(task: UsageTask, overrides: Partial<{
  status: string
  queuePosition: number | null
  queueWaitMs: number | null
  runMs: number | null
  upstreamStatus: number | null
  cancelReason: string | null
  releaseReason: string | null
}> = {}): import("../lib/usage-gate-log").UsageGateLogEntry {
  return {
    requestId: task.requestId,
    taskId: task.taskId,
    userId: task.userId,
    scene: task.scene,
    lane: task.lane,
    status: overrides.status ?? task.status,
    ownerTabId: task.ownerTabId,
    queuePosition: overrides.queuePosition ?? null,
    queueWaitMs: overrides.queueWaitMs ?? null,
    runMs: overrides.runMs ?? null,
    upstreamStatus: overrides.upstreamStatus ?? task.upstreamStatus,
    cancelReason: overrides.cancelReason ?? task.cancelReason,
    releaseReason: overrides.releaseReason ?? task.releaseReason,
  }
}

function buildTaskResponse(task: UsageTask, state: UsageState): Record<string, unknown> {
  const queuePosition = getTaskQueuePosition(state, task.taskId)
  const queueWaitMs = task.queuedAt !== null && task.startedAt !== null
    ? task.startedAt - task.queuedAt
    : task.status === "running"
      ? 0
      : null

  const runMs = task.startedAt !== null && task.releasedAt !== null
    ? task.releasedAt - task.startedAt
    : null

  return {
    requestId: task.requestId,
    taskId: task.taskId,
    leaseId: task.leaseId,
    userId: task.userId,
    scene: task.scene,
    lane: task.lane,
    status: task.status,
    ownerTabId: task.ownerTabId,
    queuePosition,
    queueWaitMs,
    runMs,
    upstreamStatus: task.upstreamStatus,
    cancelReason: task.cancelReason,
    releaseReason: task.releaseReason,
    requestCount: 1,
  }
}

function findTaskByLeaseId(state: UsageState, leaseId: string): UsageTask | null {
  for (const task of Object.values(state.tasks)) {
    if (task.leaseId === leaseId) {
      return task
    }
  }
  return null
}

function removeFromQueue(state: UsageState, taskId: string): void {
  const index = state.queueOrder.indexOf(taskId)
  if (index >= 0) {
    state.queueOrder.splice(index, 1)
  }
}

function releaseTask(task: UsageTask, now: number, releaseReason: string | null, upstreamStatus: number | null): void {
  task.status = "released"
  task.releasedAt = now
  task.releaseReason = releaseReason
  task.upstreamStatus = upstreamStatus
  task.leaseId = null
}

function cancelTask(task: UsageTask, now: number, cancelReason: string | null): void {
  task.status = "canceled"
  task.canceledAt = now
  task.cancelReason = cancelReason
  task.leaseId = null
}

function expireTask(task: UsageTask, now: number): void {
  task.status = "expired"
  task.releasedAt = now
  task.releaseReason = "lease-expired"
  task.leaseId = null
}

export class UsageGate {
  private readonly ctx: DurableObjectState
  private readonly env: UsageGateEnv
  private readonly translationTaskControllers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
  private readonly translationTaskKeepaliveTimers = new WeakMap<ReadableStreamDefaultController<Uint8Array>, number>()
  private readonly encoder = new TextEncoder()

  constructor(ctx: DurableObjectState, env: UsageGateEnv) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/reserve" || url.pathname === "/tasks/create") {
      return await this.handleCreate(request)
    }

    if (url.pathname === "/tasks/assign") {
      return await this.handleAssign(request)
    }

    if (url.pathname === "/complete" || url.pathname === "/tasks/release") {
      return await this.handleRelease(request)
    }

    if (url.pathname === "/tasks/cancel") {
      return await this.handleCancel(request)
    }

    if (url.pathname === "/tasks/lease-expired" || url.pathname === "/tasks/lease-expiry" || url.pathname === "/tasks/expire") {
      return await this.handleLeaseExpired(request)
    }

    if (url.pathname === "/translation-tasks/stream") {
      return await this.handleTranslationTaskStream(request)
    }

    if (url.pathname === "/translation-tasks/publish") {
      return await this.handleTranslationTaskPublish(request)
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  }

  private async handleCreate(request: Request): Promise<Response> {
    const payload = await request.json() as CreateTaskRequest
    const state = await this.loadState()
    const now = Date.now()

    if (state.requestCount >= payload.entitlements.monthlyRequestLimit) {
      return Response.json({ error: "Monthly request limit reached" }, { status: 402 })
    }

    const taskId = payload.taskId ?? crypto.randomUUID()
    const existing = state.tasks[taskId]
    if (existing) {
      return Response.json(buildTaskResponse(existing, state))
    }

    const task: UsageTask = {
      taskId,
      requestId: payload.requestId ?? crypto.randomUUID(),
      userId: payload.userId,
      scene: payload.scene ?? null,
      lane: payload.lane ?? "interactive",
      status: "queued",
      ownerTabId: payload.ownerTabId ?? null,
      requestKind: payload.requestKind,
      concurrentRequestLimit: payload.entitlements.concurrentRequestLimit,
      createdAt: now,
      queuedAt: null,
      startedAt: null,
      releasedAt: null,
      canceledAt: null,
      leaseId: null,
      cancelReason: null,
      releaseReason: null,
      upstreamStatus: null,
    }

    const lane = chooseLane(state, task.lane, payload.entitlements)
    if (!lane && state.queueOrder.length >= BACKGROUND_QUEUE_LIMIT) {
      return Response.json({ error: "Background queue is full" }, { status: 429 })
    }

    state.requestCount += 1

    if (lane) {
      task.lane = lane
      task.status = "running"
      task.startedAt = now
      task.leaseId = crypto.randomUUID()
      task.releaseReason = null
      task.cancelReason = null
      state.tasks[task.taskId] = task
      state.leases[task.leaseId] = now
      syncState(state)
      await this.persistState(state)
      await this.enqueueTask(task)

      const response = buildTaskResponse(task, state)
      logUsageGateEvent(buildTaskLog(task, {
        status: "running",
        queuePosition: null,
        queueWaitMs: 0,
        runMs: null,
        upstreamStatus: null,
        cancelReason: null,
        releaseReason: null,
      }))

      return Response.json(response)
    }

    task.status = "queued"
    task.queuedAt = now
    state.tasks[task.taskId] = task
    state.queueOrder.push(task.taskId)
    syncState(state)
    await this.persistState(state)

    const queuePosition = getTaskQueuePosition(state, task.taskId)
    void this.enqueueTask(task)

    logUsageGateEvent(buildTaskLog(task, {
      status: "queued",
      queuePosition,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    }))

    return Response.json(buildTaskResponse(task, state))
  }

  private async handleAssign(request: Request): Promise<Response> {
    const payload = await request.json() as AssignTaskRequest
    const state = await this.loadState()
    const now = Date.now()
    const task = state.tasks[payload.taskId]
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 })
    }

    if (task.status === "running" || task.status === "released" || task.status === "canceled" || task.status === "expired") {
      return Response.json(buildTaskResponse(task, state))
    }

    const lane = chooseLane(state, task.lane, this.taskEntitlements(task))
    if (!lane) {
      return Response.json(buildTaskResponse(task, state))
    }

    removeFromQueue(state, task.taskId)
    task.lane = lane
    task.status = "running"
    task.startedAt = now
    task.leaseId = crypto.randomUUID()
    task.releaseReason = null
    task.cancelReason = null
    state.leases[task.leaseId] = now
    syncState(state)
    await this.persistState(state)

    const response = buildTaskResponse(task, state)
    logUsageGateEvent(buildTaskLog(task, {
      status: "running",
      queuePosition: null,
      queueWaitMs: task.queuedAt !== null ? now - task.queuedAt : 0,
      runMs: null,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: null,
    }))

    return Response.json(response)
  }

  private async handleRelease(request: Request): Promise<Response> {
    const payload = await request.json() as ReleaseTaskRequest
    const state = await this.loadState()
    const now = Date.now()
    const task = payload.taskId
      ? state.tasks[payload.taskId]
      : payload.leaseId
        ? findTaskByLeaseId(state, payload.leaseId)
        : null

    if (!task) {
      return Response.json({ ok: true, status: "released" })
    }

    if (task.status === "queued") {
      removeFromQueue(state, task.taskId)
      releaseTask(task, now, payload.releaseReason ?? "released", payload.upstreamStatus ?? null)
      syncState(state)
      await this.persistState(state)

      logUsageGateEvent(buildTaskLog(task, {
        status: "released",
        queuePosition: null,
        queueWaitMs: null,
        runMs: null,
        upstreamStatus: payload.upstreamStatus ?? null,
        releaseReason: payload.releaseReason ?? "released",
      }))

      return Response.json({ ok: true, status: "released", ...buildTaskResponse(task, state) })
    }

    if (task.status !== "running") {
      return Response.json({ ok: true, status: task.status, ...buildTaskResponse(task, state) })
    }

    if (task.leaseId) {
      delete state.leases[task.leaseId]
    }

    releaseTask(task, now, payload.releaseReason ?? "released", payload.upstreamStatus ?? null)
    syncState(state)
    await this.persistState(state)

    const runMs = task.startedAt !== null ? now - task.startedAt : null
    logUsageGateEvent(buildTaskLog(task, {
      status: "released",
      queuePosition: null,
      queueWaitMs: null,
      runMs,
      upstreamStatus: payload.upstreamStatus ?? null,
      releaseReason: payload.releaseReason ?? "released",
    }))

    return Response.json({ ok: true, status: "released", ...buildTaskResponse(task, state) })
  }

  private async handleCancel(request: Request): Promise<Response> {
    const payload = await request.json() as CancelTaskRequest
    const state = await this.loadState()
    const now = Date.now()
    const task = state.tasks[payload.taskId]

    if (!task) {
      return Response.json({ ok: true, status: "canceled" })
    }

    removeFromQueue(state, task.taskId)
    if (task.leaseId) {
      delete state.leases[task.leaseId]
    }

    cancelTask(task, now, payload.cancelReason ?? "canceled")
    syncState(state)
    await this.persistState(state)

    logUsageGateEvent(buildTaskLog(task, {
      status: "canceled",
      queuePosition: null,
      queueWaitMs: null,
      runMs: null,
      upstreamStatus: null,
      cancelReason: payload.cancelReason ?? "canceled",
      releaseReason: null,
    }))

    return Response.json({ ok: true, status: "canceled", ...buildTaskResponse(task, state) })
  }

  private async handleLeaseExpired(request: Request): Promise<Response> {
    const payload = await request.json() as LeaseExpiredRequest
    const state = await this.loadState()
    const now = Date.now()
    const task = payload.taskId
      ? state.tasks[payload.taskId]
      : payload.leaseId
        ? findTaskByLeaseId(state, payload.leaseId)
        : null

    if (!task) {
      return Response.json({ ok: true, status: "expired" })
    }

    if (task.status !== "running") {
      return Response.json({ ok: true, status: task.status, ...buildTaskResponse(task, state) })
    }

    if (task.leaseId) {
      delete state.leases[task.leaseId]
    }

    expireTask(task, now)
    syncState(state)
    await this.persistState(state)

    const runMs = task.startedAt !== null ? now - task.startedAt : null
    logUsageGateEvent(buildTaskLog(task, {
      status: "expired",
      queuePosition: null,
      queueWaitMs: null,
      runMs,
      upstreamStatus: null,
      cancelReason: null,
      releaseReason: "lease-expired",
    }))

    return Response.json({ ok: true, status: "expired", ...buildTaskResponse(task, state) })
  }

  private async handleTranslationTaskStream(request: Request): Promise<Response> {
    const payload = await request.json() as TranslationTaskStreamRequest
    const taskId = payload.taskId
    const initialSnapshot = payload.snapshot
    request.signal.addEventListener("abort", () => {
      this.removeTranslationTaskController(taskId)
    }, { once: true })

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const controllers = this.translationTaskControllers.get(taskId) ?? new Set<ReadableStreamDefaultController<Uint8Array>>()
        controllers.add(controller)
        this.translationTaskControllers.set(taskId, controllers)

        this.writeTranslationTaskEvent(controller, "snapshot", initialSnapshot)

        const keepaliveId = setInterval(() => {
          this.writeTranslationTaskEvent(controller, "keepalive", {
            taskId,
            ts: Date.now(),
          })
        }, 15000)
        this.translationTaskKeepaliveTimers.set(controller, keepaliveId as unknown as number)
      },
      cancel: () => {
        this.removeTranslationTaskController(taskId)
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    })
  }

  private async handleTranslationTaskPublish(request: Request): Promise<Response> {
    const payload = await request.json() as TranslationTaskPublishRequest
    const controllers = this.translationTaskControllers.get(payload.taskId)
    if (!controllers?.size) {
      return Response.json({ ok: true })
    }

    for (const controller of [...controllers]) {
      this.writeTranslationTaskEvent(controller, payload.event, payload.data)
      if (payload.event === "completed" || payload.event === "failed" || payload.event === "canceled") {
        controller.close()
        this.clearTranslationTaskKeepalive(controller)
        controllers.delete(controller)
      }
    }

    if (controllers.size === 0) {
      this.translationTaskControllers.delete(payload.taskId)
    }

    return Response.json({ ok: true })
  }

  private async loadState(): Promise<UsageState> {
    const stored = await this.ctx.storage.get("usage-state")
    const state = normalizeState(stored)

    if (state.monthKey !== currentMonthKey()) {
      return createEmptyState()
    }

    const now = Date.now()
    if (this.pruneExpiredLeases(state, now)) {
      await this.persistState(state)
    }

    syncState(state)
    return state
  }

  private async persistState(state: UsageState): Promise<void> {
    syncState(state)
    await this.ctx.storage.put("usage-state", state)
  }

  private pruneExpiredLeases(state: UsageState, now: number): boolean {
    let changed = false

    for (const task of Object.values(state.tasks)) {
      if (task.status !== "running" || task.startedAt === null) {
        continue
      }

      const expired = now - task.startedAt >= ACTIVE_LEASE_TTL_MS
      if (!expired) {
        continue
      }

      if (task.leaseId) {
        delete state.leases[task.leaseId]
      }
      expireTask(task, now)
      changed = true
    }

    if (changed) {
      syncState(state)
    }

    return changed
  }

  private taskEntitlements(task: UsageTask): Entitlements {
    return {
      plan: "free",
      monthlyRequestLimit: Number.POSITIVE_INFINITY,
      monthlyTokenLimit: Number.POSITIVE_INFINITY,
      concurrentRequestLimit: task.concurrentRequestLimit,
    }
  }

  private async enqueueTask(task: UsageTask): Promise<void> {
    if (task.lane !== "background") {
      return
    }

    const queue = this.env.USAGE_GATE_BACKGROUND_QUEUE
    if (!queue) {
      return
    }

    const message: UsageGateQueueMessage = {
      taskId: task.taskId,
      requestId: task.requestId,
      userId: task.userId,
      scene: task.scene,
      lane: task.lane,
      ownerTabId: task.ownerTabId,
    }

    try {
      await queue.send(message)
    }
    catch {
      // Leave the task queued; the direct caller can still poll /tasks/assign.
    }
  }

  private writeTranslationTaskEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: Record<string, unknown>,
  ): void {
    controller.enqueue(this.encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  private clearTranslationTaskKeepalive(controller: ReadableStreamDefaultController<Uint8Array>): void {
    const keepaliveId = this.translationTaskKeepaliveTimers.get(controller)
    if (keepaliveId !== undefined) {
      clearInterval(keepaliveId)
      this.translationTaskKeepaliveTimers.delete(controller)
    }
  }

  private removeTranslationTaskController(taskId: string): void {
    const controllers = this.translationTaskControllers.get(taskId)
    if (!controllers) {
      return
    }

    for (const controller of controllers) {
      this.clearTranslationTaskKeepalive(controller)
    }

    this.translationTaskControllers.delete(taskId)
  }
}
