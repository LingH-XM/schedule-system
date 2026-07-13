import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { AuthService } from './auth.service.js'

@Controller('/api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('/login')
  async login(@Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }

    const username = String((body as { username?: unknown }).username || '').trim()
    const password = String((body as { password?: unknown }).password || '')
    const result = await this.authService.login(username, password)

    if (!result.ok) {
      return result
    }

    return {
      ok: true,
      token: `mock-token-${result.user.username}`,
      user: result.user
    }
  }

  @Get('/users')
  async listUsers(@Query('includeDeleted') includeDeleted?: string) {
    const users = await this.authService.listUsers(includeDeleted === '1' || includeDeleted === 'true')
    return { ok: true, users }
  }

  @Post('/users')
  async createUser(@Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }

    const accountName = String((body as { accountName?: unknown }).accountName || '').trim()
    const phone = String((body as { phone?: unknown }).phone || '').trim()
    const role = String((body as { role?: unknown }).role || 'admin').trim()

    if (!accountName) {
      throw new BadRequestException('accountName is required')
    }

    const result = await this.authService.createUser({
      accountName,
      phone,
      role: role === 'super_admin' ? 'super_admin' : 'admin'
    })
    return result
  }

  @Patch('/users/:username')
  async updateUserInfo(@Param('username') username: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }

    const accountId = String((body as { accountId?: unknown }).accountId || '').trim()
    const accountName = String((body as { accountName?: unknown }).accountName || '').trim()
    const phone = String((body as { phone?: unknown }).phone || '').trim()
    const role = String((body as { role?: unknown }).role || 'admin').trim()

    if (!accountId || !accountName) {
      throw new BadRequestException('accountId and accountName are required')
    }

    return this.authService.updateUserInfo({
      currentUsername: String(username || '').trim(),
      accountId,
      accountName,
      phone,
      role: role === 'super_admin' ? 'super_admin' : 'admin'
    })
  }

  @Patch('/users/:username/status')
  async updateUserStatus(@Param('username') username: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const isActive = Boolean((body as { isActive?: unknown }).isActive)
    return this.authService.setUserActive(String(username || '').trim(), isActive)
  }

  @Patch('/users/:username/password')
  async resetPassword(@Param('username') username: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid payload: expected JSON object')
    }
    const password = String((body as { password?: unknown }).password || '')
    return this.authService.resetPassword(String(username || '').trim(), password)
  }

  @Post('/users/:username/restore')
  async restoreUser(@Param('username') username: string) {
    return this.authService.restoreUser(String(username || '').trim())
  }

  @Delete('/users/:username/permanent')
  async purgeUser(@Param('username') username: string) {
    return this.authService.purgeUser(String(username || '').trim())
  }

  @Delete('/users/:username')
  async deleteUser(@Param('username') username: string) {
    return this.authService.deleteUser(String(username || '').trim())
  }
}
