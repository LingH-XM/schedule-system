import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import { hasPermission, hasScope, type AuthContext, type AuthenticatedRequest } from './auth.types.js'
import { JsonStorageService } from './json-storage.service.js'
import { normalizeProfile, sanitizePlanId } from './types.js'

@Controller()
@UseGuards(AuthGuard)
export class ScheduleStateController {
  constructor(@Inject(JsonStorageService) private readonly storage: JsonStorageService) {}

  @Get('/api/:profile/schedule-plans')
  async getSchedulePlans(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam?: string
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'schedule.read')) throw new ForbiddenException('没有查看排课方案的权限')
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const payload = await this.storage.read(auth.schoolId, profile, planId, 'schedule-plans')
    return this.filterPlans(auth, payload)
  }

  @Put('/api/:profile/schedule-plans')
  async putSchedulePlans(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'schedule.edit')) throw new ForbiddenException('没有修改排课方案的权限')
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const current = await this.storage.read(auth.schoolId, profile, planId, 'schedule-plans')
    return this.write(auth.schoolId, profile, planId, this.mergePlans(auth, current, body), 'schedule-plans')
  }

  @Get('/api/:profile/workbench-state')
  async getWorkbenchState(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam?: string
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'schedule.read')) throw new ForbiddenException('没有查看排课工作台的权限')
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const [payload, plans] = await Promise.all([
      this.storage.read(auth.schoolId, profile, planId, 'workbench-state'),
      this.storage.read(auth.schoolId, profile, planId, 'schedule-plans')
    ])
    return this.filterWorkbench(auth, plans, payload)
  }

  @Put('/api/:profile/workbench-state')
  async putWorkbenchState(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'schedule.edit')) throw new ForbiddenException('没有修改排课工作台的权限')
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const [current, plans] = await Promise.all([
      this.storage.read(auth.schoolId, profile, planId, 'workbench-state'),
      this.storage.read(auth.schoolId, profile, planId, 'schedule-plans')
    ])
    return this.write(auth.schoolId, profile, planId, this.mergeWorkbench(auth, plans, current, body), 'workbench-state')
  }

  private parseProfile(profileParam: string): 'test' | 'prod' {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    return normalizeProfile(profileParam)
  }

  private async write(
    schoolId: string,
    profile: 'test' | 'prod',
    planIdParam: string,
    body: unknown,
    resource: 'schedule-plans' | 'workbench-state'
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const planId = sanitizePlanId(planIdParam)
    const payload = {
      ...(body as Record<string, unknown>),
      _savedAt:
        typeof (body as { _savedAt?: unknown })._savedAt === 'number' && Number.isFinite((body as { _savedAt?: unknown })._savedAt)
          ? Number((body as { _savedAt?: number })._savedAt)
          : Date.now()
    }
    await this.storage.write(schoolId, profile, planId, resource, payload)
    return { ok: true, schoolId, profile, planId, resource }
  }

  private filterPlans(auth: AuthContext, raw: unknown): Record<string, unknown> {
    const payload = asObject(raw)
    if (this.isUnrestricted(auth)) return payload
    return { ...payload, plans: asArray(payload.plans).filter((plan) => this.canAccessPlan(auth, plan)) }
  }

  private mergePlans(auth: AuthContext, currentRaw: unknown, incomingRaw: unknown): Record<string, unknown> {
    const incoming = asObject(incomingRaw)
    if (this.isUnrestricted(auth)) return incoming
    const current = asObject(currentRaw)
    const currentPlans = asArray(current.plans)
    const byId = new Map(currentPlans.map((plan) => [String(plan.id || ''), plan]))
    const retained = currentPlans.filter((plan) => !this.canAccessPlan(auth, plan))
    const editable = asArray(incoming.plans).flatMap((plan) => {
      const id = String(plan.id || '')
      const existing = byId.get(id)
      if (existing && !this.canAccessPlan(auth, existing)) return []
      return [{
        ...plan,
        ownerUserId: existing?.ownerUserId || auth.userId,
        scopes: existing?.scopes || auth.scopes
      }]
    })
    return { ...current, ...incoming, plans: [...editable, ...retained] }
  }

  private filterWorkbench(auth: AuthContext, plansRaw: unknown, workbenchRaw: unknown): Record<string, unknown> {
    const payload = asObject(workbenchRaw)
    if (this.isUnrestricted(auth)) return payload
    const allowed = this.allowedPlanIds(auth, plansRaw)
    return this.mapWorkbenchCollections(payload, (entries) =>
      Object.fromEntries(Object.entries(entries).filter(([id]) => allowed.has(id)))
    )
  }

  private mergeWorkbench(auth: AuthContext, plansRaw: unknown, currentRaw: unknown, incomingRaw: unknown): Record<string, unknown> {
    const incoming = asObject(incomingRaw)
    if (this.isUnrestricted(auth)) return incoming
    const current = asObject(currentRaw)
    const allowed = this.allowedPlanIds(auth, plansRaw)
    const merged = { ...current, ...incoming }
    return this.mapWorkbenchCollections(merged, (_entries, key) => ({
      ...Object.fromEntries(Object.entries(asObject(current[key])).filter(([id]) => !allowed.has(id))),
      ...Object.fromEntries(Object.entries(asObject(incoming[key])).filter(([id]) => allowed.has(id)))
    }))
  }

  private mapWorkbenchCollections(
    source: Record<string, unknown>,
    mapper: (entries: Record<string, unknown>, key: string) => Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...source }
    for (const key of ['entries', 'publishedEntries', 'meta', 'drafts', 'logs']) {
      result[key] = mapper(asObject(source[key]), key)
    }
    return result
  }

  private allowedPlanIds(auth: AuthContext, plansRaw: unknown): Set<string> {
    return new Set(asArray(asObject(plansRaw).plans).filter((plan) => this.canAccessPlan(auth, plan)).map((plan) => String(plan.id || '')))
  }

  private canAccessPlan(auth: AuthContext, plan: Record<string, unknown>): boolean {
    if (this.isUnrestricted(auth)) return true
    if (String(plan.ownerUserId || '') === auth.userId) return true
    return asArray(plan.scopes).some((scope) => hasScope(auth, String(scope.campusId || ''), String(scope.grade || '')))
  }

  private isUnrestricted(auth: AuthContext): boolean {
    return auth.role === 'super_admin' || auth.role === 'school_admin'
  }
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}

function asArray(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : []
}
