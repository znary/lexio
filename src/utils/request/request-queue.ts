import { deepmerge } from "deepmerge-ts"
import { requestQueueConfigSchema } from "@/types/config/translate"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { logger } from "@/utils/logger"
import { BinaryHeapPQ } from "./priority-queue"

export interface RequestTask {
  id: string
  thunk: (signal: AbortSignal) => Promise<any>
  promise: Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  scheduleAt: number
  createdAt: number
  retryCount: number
}

export interface QueueOptions {
  name?: string
  rate: number // tokens/sec
  capacity: number // token bucket size
  timeoutMs: number
  maxRetries: number
  baseRetryDelayMs: number
  maxConcurrency?: number
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<RequestTask & { hash: string }>
  private waitingTasks = new Map<string, RequestTask>()
  private executingTasks = new Map<string, RequestTask>()
  private nextScheduleTimer: NodeJS.Timeout | null = null
  private maxConcurrency: number

  // token bucket
  private bucketTokens: number
  private lastRefill: number

  constructor(private options: QueueOptions) {
    this.options = options
    this.maxConcurrency = options.maxConcurrency ?? Number.POSITIVE_INFINITY
    this.bucketTokens = options.capacity
    this.lastRefill = Date.now()
    this.waitingQueue = new BinaryHeapPQ<RequestTask & { hash: string }>()
  }

  private log(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
    const payload = {
      queue: this.options.name ?? "request-queue",
      event,
      ...details,
    }

    if (level === "warn") {
      logger.warn("[RequestQueue]", payload)
      return
    }

    if (level === "error") {
      logger.error("[RequestQueue]", payload)
      return
    }

    logger.info("[RequestQueue]", payload)
  }

  private getQueueState() {
    return {
      waitingCount: this.waitingQueue.size(),
      waitingTaskCount: this.waitingTasks.size,
      executingCount: this.executingTasks.size,
      bucketTokens: Number(this.bucketTokens.toFixed(2)),
    }
  }

  enqueue<T>(thunk: (signal: AbortSignal) => Promise<T>, scheduleAt: number, hash: string): Promise<T> {
    const duplicateTask = this.duplicateTask(hash)
    if (duplicateTask) {
      this.log("info", "duplicate", {
        hash,
        taskId: duplicateTask.id,
        retryCount: duplicateTask.retryCount,
        ...this.getQueueState(),
      })
      return duplicateTask.promise
    }

    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    const task: RequestTask = {
      id: getRandomUUID(),
      thunk,
      promise,
      resolve,
      reject,
      scheduleAt,
      createdAt: Date.now(),
      retryCount: 0,
    }

    this.waitingTasks.set(hash, task)
    this.waitingQueue.push({ ...task, hash }, scheduleAt)

    this.log("info", "enqueue", {
      hash,
      taskId: task.id,
      scheduleAt,
      createdAt: task.createdAt,
      scheduledDelayMs: Math.max(0, scheduleAt - task.createdAt),
      ...this.getQueueState(),
    })

    this.schedule()
    return promise
  }

  setQueueOptions(options: Partial<QueueOptions>) {
    const parseConfigStatus = requestQueueConfigSchema.partial().safeParse(options)
    if (parseConfigStatus.error) {
      throw new Error(parseConfigStatus.error.issues[0].message)
    }
    this.options = deepmerge(this.options, options) as QueueOptions
    if (options.capacity) {
      this.bucketTokens = options.capacity
      this.lastRefill = Date.now()
    }
  }

  private schedule() {
    this.refillTokens()

    while (
      this.bucketTokens >= 1
      && this.waitingQueue.size() > 0
      && this.executingTasks.size < this.maxConcurrency
    ) {
      const task = this.waitingQueue.peek()
      if (task && task.scheduleAt <= Date.now()) {
        this.waitingQueue.pop()
        this.waitingTasks.delete(task.hash)
        this.executingTasks.set(task.hash, task)
        this.bucketTokens--
        void this.executeTask(task)
      }
      else {
        break
      }
    }

    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }

    if (this.waitingQueue.size() > 0) {
      const nextTask = this.waitingQueue.peek()
      if (nextTask) {
        const hasExecutionSlot = this.executingTasks.size < this.maxConcurrency
        if (!hasExecutionSlot) {
          return
        }

        const now = Date.now()
        const delayUntilScheduled = Math.max(0, nextTask.scheduleAt - now)
        const msUntilNextToken = this.bucketTokens >= 1 ? 0 : Math.ceil((1 - this.bucketTokens) / this.options.rate * 1000)
        const delay = Math.max(delayUntilScheduled, msUntilNextToken)

        this.nextScheduleTimer = setTimeout(() => {
          this.nextScheduleTimer = null
          this.schedule()
        }, delay)
      }
    }
  }

  private async executeTask(task: RequestTask & { hash: string }) {
    const startedAt = Date.now()
    this.log("info", "start", {
      hash: task.hash,
      taskId: task.id,
      retryCount: task.retryCount,
      queueWaitMs: Math.max(0, startedAt - task.scheduleAt),
      totalWaitMs: startedAt - task.createdAt,
      ...this.getQueueState(),
    })

    let timeoutId: NodeJS.Timeout | null = null
    const abortController = new AbortController()

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          // console.info(`⏰ Task ${task.id} timed out after ${this.options.timeoutMs}ms`)
          const timeoutError = new Error(`Task ${task.id} timed out after ${this.options.timeoutMs}ms`)
          reject(timeoutError)
          abortController.abort(timeoutError)
        }, this.options.timeoutMs)
      })

      // Race between the actual task and timeout
      const result = await Promise.race([
        task.thunk(abortController.signal),
        timeoutPromise,
      ])

      // Clear timeout if task completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      this.log("info", "complete", {
        hash: task.hash,
        taskId: task.id,
        retryCount: task.retryCount,
        executeMs: Date.now() - startedAt,
        totalMs: Date.now() - task.createdAt,
      })
      task.resolve(result)
    }
    catch (error) {
      // Clear timeout if it hasn't fired yet
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      // Check if we should retry
      if (task.retryCount < this.options.maxRetries) {
        task.retryCount++

        // Calculate exponential backoff delay
        const backoffDelayMs = this.options.baseRetryDelayMs * (2 ** (task.retryCount - 1))

        // Add some jitter to prevent thundering herd
        const jitter = Math.random() * 0.1 * backoffDelayMs
        const delayMs = backoffDelayMs + jitter

        // Schedule retry
        const retryAt = Date.now() + delayMs
        task.scheduleAt = retryAt

        this.log("warn", "retry", {
          hash: task.hash,
          taskId: task.id,
          retryCount: task.retryCount,
          maxRetries: this.options.maxRetries,
          backoffDelayMs: Math.round(delayMs),
          error: error instanceof Error ? error.message : String(error),
        })

        // Move task back to waiting queue for retry
        this.waitingTasks.set(task.hash, task)
        this.waitingQueue.push(task, retryAt)
        this.schedule()
      }
      else {
        // Max retries exceeded, reject the promise
        this.log("error", "failed", {
          hash: task.hash,
          taskId: task.id,
          retryCount: task.retryCount,
          totalMs: Date.now() - task.createdAt,
          error: error instanceof Error ? error.message : String(error),
        })
        task.reject(error)
      }
    }
    finally {
      // Ensure timeout is always cleared
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      this.executingTasks.delete(task.hash)
      this.schedule()
    }
  }

  private duplicateTask(hash: string) {
    const duplicateTask = this.waitingTasks.get(hash) ?? this.executingTasks.get(hash)
    if (duplicateTask) {
      return duplicateTask
    }
    return undefined
  }

  private refillTokens() {
    const now = Date.now()
    const timeSinceLastRefill = now - this.lastRefill
    const tokensToAdd = (timeSinceLastRefill / 1000) * this.options.rate
    this.bucketTokens = Math.min(this.bucketTokens + tokensToAdd, this.options.capacity)

    // if (tokensToAdd > 0.01) { // Only log if meaningful tokens were added
    //   console.log(`🪣 Token bucket refilled: ${oldTokens.toFixed(2)} -> ${this.bucketTokens.toFixed(2)} (+${tokensToAdd.toFixed(2)}) after ${timeSinceLastRefill}ms`)
    // }

    this.lastRefill = now
  }
}
