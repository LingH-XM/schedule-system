import { BadRequestException, Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common'
import { JsonStorageService } from './json-storage.service.js'
import { normalizeProfile, sanitizeAccountId, sanitizePlanId } from './types.js'

@Controller()
export class RuleSettingsController {
  constructor(@Inject(JsonStorageService) private readonly storage: JsonStorageService) {}

  @Get('/api/:profile/rule-settings')
  async getScoped(
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam?: string,
    @Query('accountId') accountIdParam?: string
  ) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const accountId = sanitizeAccountId(accountIdParam)
    return this.storage.read(accountId, profile, planId, 'rule-settings')
  }

  @Put('/api/:profile/rule-settings')
  async putScoped(
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Query('accountId') accountIdParam: string | undefined,
    @Body() body: unknown
  ) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    return this.write(profile, planIdParam, accountIdParam, body, 'rule-settings')
  }

  private async write(
    profile: 'test' | 'prod',
    planIdParam: string | undefined,
    accountIdParam: string | undefined,
    body: unknown,
    resource: 'rule-settings'
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const accountId = sanitizeAccountId(accountIdParam)
    const planId = sanitizePlanId(planIdParam)
    const payload = {
      ...(body as Record<string, unknown>),
      _savedAt:
        typeof (body as { _savedAt?: unknown })._savedAt === 'number' && Number.isFinite((body as { _savedAt?: unknown })._savedAt)
          ? Number((body as { _savedAt?: number })._savedAt)
          : Date.now()
    }
    await this.storage.write(accountId, profile, planId, resource, payload)
    return { ok: true, accountId, profile, planId, resource }
  }
}
