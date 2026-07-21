import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import { hasPermission, type AuthenticatedRequest } from './auth.types.js'
import { DataScopeService } from './data-scope.service.js'
import { JsonStorageService } from './json-storage.service.js'
import { StructuredDataSyncService } from './structured-data-sync.service.js'
import { normalizeProfile, sanitizePlanId } from './types.js'

@Controller()
@UseGuards(AuthGuard)
export class BasicDataController {
  constructor(
    @Inject(JsonStorageService) private readonly storage: JsonStorageService,
    @Inject(StructuredDataSyncService) private readonly structuredSync: StructuredDataSyncService,
    @Inject(DataScopeService) private readonly dataScope: DataScopeService
  ) {}

  @Get('/api/:profile/basic-data')
  async getScoped(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam?: string
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'basic_data.read')) throw new ForbiddenException('没有查看基础数据的权限')
    const profile = this.parseProfile(profileParam)
    const payload = await this.storage.read(auth.schoolId, profile, sanitizePlanId(planIdParam), 'basic-data')
    return this.dataScope.filterBasicData(auth, payload)
  }

  @Put('/api/:profile/basic-data')
  async putScoped(
    @Req() request: AuthenticatedRequest,
    @Param('profile') profileParam: string,
    @Query('planId') planIdParam: string | undefined,
    @Body() body: unknown
  ) {
    const auth = requireAuth(request)
    if (!hasPermission(auth, 'basic_data.write') && !hasPermission(auth, 'basic_data.grade_edit')) {
      throw new ForbiddenException('没有修改基础数据的权限')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const profile = this.parseProfile(profileParam)
    const planId = sanitizePlanId(planIdParam)
    const incoming = {
      ...(body as Record<string, unknown>),
      _savedAt: Date.now()
    }
    const current = await this.storage.read(auth.schoolId, profile, planId, 'basic-data')
    const payload = this.dataScope.mergeBasicData(auth, current, incoming)
    await this.storage.write(auth.schoolId, profile, planId, 'basic-data', payload)
    await this.structuredSync.syncBasicData(auth.schoolId, profile, planId, payload)
    return { ok: true, schoolId: auth.schoolId, profile, planId, resource: 'basic-data' }
  }

  private parseProfile(raw: string): 'test' | 'prod' {
    if (!['test', 'prod'].includes(String(raw || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    return normalizeProfile(raw)
  }
}
