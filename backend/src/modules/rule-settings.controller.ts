import { BadRequestException, Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common'
import { JsonStorageService } from './json-storage.service.js'
import { normalizeProfile, sanitizePlanId } from './types.js'

@Controller()
export class RuleSettingsController {
  constructor(@Inject(JsonStorageService) private readonly storage: JsonStorageService) {}

  @Get('/api/:profile/rule-settings')
  async getScoped(@Param('profile') profileParam: string, @Query('planId') planIdParam?: string) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    return this.storage.read(profile, planId, 'rule-settings')
  }

  @Put('/api/:profile/rule-settings')
  async putScoped(
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    return this.write(profile, planIdParam, body, 'rule-settings')
  }

  private async write(profile: 'test' | 'prod', planIdParam: string | undefined, body: unknown, resource: 'rule-settings') {
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
