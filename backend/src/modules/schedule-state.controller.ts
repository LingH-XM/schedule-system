import { BadRequestException, Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common'
import { JsonStorageService } from './json-storage.service.js'
import { normalizeProfile, sanitizePlanId } from './types.js'

@Controller()
export class ScheduleStateController {
  constructor(@Inject(JsonStorageService) private readonly storage: JsonStorageService) {}

  @Get('/api/:profile/schedule-plans')
  async getSchedulePlans(@Param('profile') profileParam: string, @Query('planId') planIdParam?: string) {
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    return this.storage.read(profile, planId, 'schedule-plans')
  }

  @Put('/api/:profile/schedule-plans')
  async putSchedulePlans(
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const profile = this.parseProfile(profileParam)
    return this.write(profile, planIdParam, body, 'schedule-plans')
  }

  @Get('/api/:profile/workbench-state')
  async getWorkbenchState(@Param('profile') profileParam: string, @Query('planId') planIdParam?: string) {
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    return this.storage.read(profile, planId, 'workbench-state')
  }

  @Put('/api/:profile/workbench-state')
  async putWorkbenchState(
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const profile = this.parseProfile(profileParam)
    return this.write(profile, planIdParam, body, 'workbench-state')
  }

  private parseProfile(profileParam: string): 'test' | 'prod' {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    return normalizeProfile(profileParam)
  }

  private async write(
    profile: 'test' | 'prod',
    planIdParam: string | undefined,
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
    await this.storage.write(profile, planId, resource, payload)
    return { ok: true, profile, planId, resource }
  }
}

