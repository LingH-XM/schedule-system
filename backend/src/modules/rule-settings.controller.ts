import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import { hasPermission, type AuthenticatedRequest } from './auth.types.js'
import { JsonStorageService } from './json-storage.service.js'
import { normalizeProfile, sanitizePlanId } from './types.js'

@Controller()
@UseGuards(AuthGuard)
export class RuleSettingsController {
  constructor(@Inject(JsonStorageService) private readonly storage: JsonStorageService) {}

  @Get('/api/:profile/rule-settings')
  async getScoped(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam?: string
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'rules.read')) throw new ForbiddenException('没有查看排课规则的权限')
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    return this.storage.read(auth.schoolId, profile, planId, 'rule-settings')
  }

  @Put('/api/:profile/rule-settings')
  async putScoped(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'rules.edit')) throw new ForbiddenException('没有修改排课规则的权限')
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    return this.write(auth.schoolId, profile, planIdParam, body, 'rule-settings')
  }

  private async write(
    schoolId: string,
    profile: 'test' | 'prod',
    planIdParam: string | undefined,
    body: unknown,
    resource: 'rule-settings'
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
}
