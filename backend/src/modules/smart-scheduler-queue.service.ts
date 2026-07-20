import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { OrtoolsSolveError, SmartSchedulerService } from './smart-scheduler.service.js'
import type { DataProfile } from './types.js'
import type { SmartSolveEnvelope, SmartSolveRequest } from './smart-scheduler.types.js'

export type SmartSchedulerJobStatus = 'queued' | 'running' | 'completed' | 'failed'

type SmartSchedulerJobError = {
  code: string
  message: string
  detail: string
}

type SmartSchedulerJob = {
  id: string
  accountId: string
  profile: DataProfile
  request: SmartSolveRequest
  status: SmartSchedulerJobStatus
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
  estimatedDurationMs: number
  result: SmartSolveEnvelope | null
  error: SmartSchedulerJobError | null
}

export type SmartSchedulerJobSnapshot = {
  id: string
  status: SmartSchedulerJobStatus
  position: number
  waitingAhead: number
  queueSize: number
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
  estimatedStartAt: string | null
  estimatedFinishAt: string | null
  estimatedDurationMs: number
  result?: SmartSolveEnvelope
  error?: SmartSchedulerJobError
}

@Injectable()
export class SmartSchedulerQueueService {
  private readonly logger = new Logger(SmartSchedulerQueueService.name)
  private readonly jobs = new Map<string, SmartSchedulerJob>()
  private readonly pendingJobIds: string[] = []
  private activeJobId: string | null = null
  private processing = false
  private averageDurationMs = Math.max(1000, Number(process.env.SMART_SCHEDULER_ESTIMATE_MS || 20000))
  private completedSamples = 0

  constructor(@Inject(SmartSchedulerService) private readonly scheduler: SmartSchedulerService) {}

  enqueue(accountId: string, profile: DataProfile, request: SmartSolveRequest): SmartSchedulerJobSnapshot {
    this.cleanupFinishedJobs()
    const now = Date.now()
    const job: SmartSchedulerJob = {
      id: randomUUID(),
      accountId,
      profile,
      request,
      status: 'queued',
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      estimatedDurationMs: this.averageDurationMs,
      result: null,
      error: null
    }
    this.jobs.set(job.id, job)
    this.pendingJobIds.push(job.id)
    void this.drainQueue()
    return this.toSnapshot(job)
  }

  getJob(accountId: string, profile: DataProfile, jobId: string): SmartSchedulerJobSnapshot | null {
    const job = this.jobs.get(jobId)
    if (!job || job.accountId !== accountId || job.profile !== profile) return null
    return this.toSnapshot(job)
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.pendingJobIds.length > 0) {
        const jobId = this.pendingJobIds.shift()
        if (!jobId) continue
        const job = this.jobs.get(jobId)
        if (!job || job.status !== 'queued') continue

        this.activeJobId = job.id
        job.status = 'running'
        job.startedAt = Date.now()
        this.logger.log(`开始智能排课任务 ${job.id}，账户 ${job.accountId}`)
        try {
          job.result = await this.scheduler.solveSmart(job.request)
          job.status = 'completed'
        } catch (error) {
          job.error = this.normalizeError(error)
          job.status = 'failed'
        } finally {
          job.completedAt = Date.now()
          const durationMs = Math.max(1, job.completedAt - (job.startedAt || job.queuedAt))
          this.updateAverageDuration(durationMs)
          this.logger.log(
            `结束智能排课任务 ${job.id}，状态 ${job.status}，耗时 ${durationMs}ms`
          )
          this.activeJobId = null
        }
      }
    } finally {
      this.processing = false
      if (this.pendingJobIds.length > 0) void this.drainQueue()
    }
  }

  private toSnapshot(job: SmartSchedulerJob): SmartSchedulerJobSnapshot {
    const now = Date.now()
    const queueSize = this.pendingJobIds.length + (this.activeJobId ? 1 : 0)
    let position = 0
    let waitingAhead = 0
    let estimatedStartAt: number | null = job.startedAt
    let estimatedFinishAt: number | null = job.completedAt

    if (job.status === 'queued') {
      const pendingIndex = this.pendingJobIds.indexOf(job.id)
      position = Math.max(1, pendingIndex + 1)
      waitingAhead = Math.max(0, pendingIndex) + (this.activeJobId ? 1 : 0)
      let waitMs = this.activeRemainingMs(now)
      for (let index = 0; index < pendingIndex; index += 1) {
        const ahead = this.jobs.get(this.pendingJobIds[index])
        waitMs += ahead?.estimatedDurationMs || this.averageDurationMs
      }
      estimatedStartAt = now + waitMs
      estimatedFinishAt = estimatedStartAt + job.estimatedDurationMs
    } else if (job.status === 'running') {
      estimatedFinishAt = (job.startedAt || now) + job.estimatedDurationMs
    }

    const snapshot: SmartSchedulerJobSnapshot = {
      id: job.id,
      status: job.status,
      position,
      waitingAhead,
      queueSize,
      queuedAt: new Date(job.queuedAt).toISOString(),
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
      completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
      estimatedStartAt: estimatedStartAt ? new Date(estimatedStartAt).toISOString() : null,
      estimatedFinishAt: estimatedFinishAt ? new Date(estimatedFinishAt).toISOString() : null,
      estimatedDurationMs: job.estimatedDurationMs
    }
    if (job.status === 'completed' && job.result) snapshot.result = job.result
    if (job.status === 'failed' && job.error) snapshot.error = job.error
    return snapshot
  }

  private activeRemainingMs(now: number): number {
    if (!this.activeJobId) return 0
    const active = this.jobs.get(this.activeJobId)
    if (!active) return 0
    const elapsed = Math.max(0, now - (active.startedAt || now))
    return Math.max(1000, active.estimatedDurationMs - elapsed)
  }

  private updateAverageDuration(durationMs: number): void {
    this.completedSamples += 1
    if (this.completedSamples === 1) {
      this.averageDurationMs = durationMs
      return
    }
    this.averageDurationMs = Math.max(1000, Math.round(this.averageDurationMs * 0.7 + durationMs * 0.3))
  }

  private normalizeError(error: unknown): SmartSchedulerJobError {
    if (error instanceof OrtoolsSolveError) {
      return {
        code: error.code,
        message: `智能排课失败：${error.message}`,
        detail: error.detail
      }
    }
    return {
      code: 'ORTOOLS_UNKNOWN',
      message: `智能排课失败：${error instanceof Error ? error.message : String(error)}`,
      detail: ''
    }
  }

  private cleanupFinishedJobs(): void {
    const expiresBefore = Date.now() - 60 * 60 * 1000
    for (const [jobId, job] of this.jobs.entries()) {
      if (
        ['completed', 'failed'].includes(job.status) &&
        (job.completedAt || job.queuedAt) < expiresBefore
      ) {
        this.jobs.delete(jobId)
      }
    }
    if (this.jobs.size <= 200) return
    const finished = Array.from(this.jobs.values())
      .filter((job) => ['completed', 'failed'].includes(job.status))
      .sort((left, right) => (left.completedAt || 0) - (right.completedAt || 0))
    finished.slice(0, this.jobs.size - 200).forEach((job) => this.jobs.delete(job.id))
  }
}
