import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import type { AuthenticatedRequest } from './auth.types.js'
import { SchoolFeaturesService } from './school-features.service.js'

@Controller('/api/school-features')
@UseGuards(AuthGuard)
export class SchoolFeaturesController {
  constructor(@Inject(SchoolFeaturesService) private readonly schoolFeaturesService: SchoolFeaturesService) {}

  @Get('/catalog')
  catalog(@Req() request: AuthenticatedRequest) {
    requireSuperAdmin(request)
    return { ok: true, features: this.schoolFeaturesService.getCatalog() }
  }

  @Get('/schools')
  async listSchools(@Req() request: AuthenticatedRequest) {
    requireSuperAdmin(request)
    return { ok: true, schools: await this.schoolFeaturesService.listSchools() }
  }

  @Get('/schools/:schoolId')
  async getSchool(@Req() request: AuthenticatedRequest, @Param('schoolId') schoolId: string) {
    requireSuperAdmin(request)
    const school = await this.schoolFeaturesService.getSchool(String(schoolId || '').trim())
    if (!school) throw new NotFoundException('School not found')
    return { ok: true, school }
  }

  @Patch('/schools/:schoolId')
  async updateSchool(
    @Req() request: AuthenticatedRequest,
    @Param('schoolId') schoolId: string,
    @Body() body: unknown
  ) {
    requireSuperAdmin(request)
    const payload = asObject(body)
    const school = await this.schoolFeaturesService.updateSchool(String(schoolId || '').trim(), payload)
    if (!school) throw new NotFoundException('School not found')
    return { ok: true, school }
  }

  @Get('/current')
  async getCurrentSchool(@Req() request: AuthenticatedRequest) {
    const auth = requireAuth(request)
    const school = await this.schoolFeaturesService.getSchool(auth.schoolId)
    if (!school) throw new NotFoundException('School not found')
    return {
      ok: true,
      school: {
        schoolId: school.schoolId,
        featureFlags: school.featureFlags,
        featureSettings: school.featureSettings,
        updatedAt: school.updatedAt
      }
    }
  }
}

function requireSuperAdmin(request: AuthenticatedRequest) {
  const auth = requireAuth(request)
  if (auth.role !== 'super_admin') throw new ForbiddenException('Super administrator required')
  return auth
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}
