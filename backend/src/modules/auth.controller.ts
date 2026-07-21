import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { normalizeRole, normalizeStringList, type AuthenticatedRequest } from './auth.types.js'

@Controller('/api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('/login')
  async login(@Body() body: unknown) {
    const payload = asObject(body)
    return this.authService.login(String(payload.username || '').trim(), String(payload.password || ''))
  }

  @Get('/users')
  @UseGuards(AuthGuard)
  async listUsers(@Req() request: AuthenticatedRequest, @Query('includeDeleted') includeDeleted?: string) {
    const users = await this.authService.listUsers(requireAuth(request), includeDeleted === '1' || includeDeleted === 'true')
    return { ok: true, users }
  }

  @Post('/users')
  @UseGuards(AuthGuard)
  async createUser(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const payload = asObject(body)
    const name = String(payload.name || payload.accountName || '').trim()
    if (!name) throw new BadRequestException('name is required')
    return this.authService.createUser(requireAuth(request), {
      name,
      schoolName: String(payload.schoolName || payload.accountName || '').trim(),
      phone: String(payload.phone || '').trim(),
      role: normalizeRole(payload.role),
      permissions: normalizeStringList(payload.permissions),
      campusIds: normalizeStringList(payload.campusIds),
      grades: normalizeStringList(payload.grades)
    })
  }

  @Patch('/users/:username')
  @UseGuards(AuthGuard)
  async updateUserInfo(@Req() request: AuthenticatedRequest, @Param('username') username: string, @Body() body: unknown) {
    const payload = asObject(body)
    const schoolId = String(payload.schoolId || '').trim()
    const name = String(payload.name || payload.accountName || '').trim()
    if (!schoolId || !name) throw new BadRequestException('schoolId and name are required')
    return this.authService.updateUserInfo(requireAuth(request), {
      currentUsername: String(username || '').trim(),
      schoolId,
      name,
      schoolName: String(payload.schoolName || payload.accountName || '').trim(),
      phone: String(payload.phone || '').trim(),
      role: normalizeRole(payload.role),
      permissions: normalizeStringList(payload.permissions),
      campusIds: normalizeStringList(payload.campusIds),
      grades: normalizeStringList(payload.grades)
    })
  }

  @Patch('/users/:username/status')
  @UseGuards(AuthGuard)
  async updateUserStatus(@Req() request: AuthenticatedRequest, @Param('username') username: string, @Body() body: unknown) {
    const payload = asObject(body)
    return this.authService.setUserActive(requireAuth(request), String(username || '').trim(), Boolean(payload.isActive))
  }

  @Patch('/users/:username/password')
  @UseGuards(AuthGuard)
  async resetPassword(@Req() request: AuthenticatedRequest, @Param('username') username: string, @Body() body: unknown) {
    const payload = asObject(body)
    return this.authService.resetPassword(requireAuth(request), String(username || '').trim(), String(payload.password || ''))
  }

  @Patch('/password')
  @UseGuards(AuthGuard)
  async changeOwnPassword(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const payload = asObject(body)
    return this.authService.changeOwnPassword(
      requireAuth(request),
      String(payload.currentPassword || ''),
      String(payload.nextPassword || '')
    )
  }

  @Post('/users/:username/restore')
  @UseGuards(AuthGuard)
  async restoreUser(@Req() request: AuthenticatedRequest, @Param('username') username: string) {
    return this.authService.restoreUser(requireAuth(request), String(username || '').trim())
  }

  @Delete('/users/:username/permanent')
  @UseGuards(AuthGuard)
  async purgeUser(@Req() request: AuthenticatedRequest, @Param('username') username: string) {
    return this.authService.purgeUser(requireAuth(request), String(username || '').trim())
  }

  @Delete('/users/:username')
  @UseGuards(AuthGuard)
  async deleteUser(@Req() request: AuthenticatedRequest, @Param('username') username: string) {
    return this.authService.deleteUser(requireAuth(request), String(username || '').trim())
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid payload: expected JSON object')
  }
  return body as Record<string, unknown>
}
