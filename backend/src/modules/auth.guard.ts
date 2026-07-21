import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import type { AuthenticatedRequest } from './auth.types.js'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const rawHeader = request.headers?.authorization
    const authorization = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
    const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) throw new UnauthorizedException('登录状态已失效，请重新登录')

    const auth = await this.authService.resolveSession(token)
    if (!auth) throw new UnauthorizedException('登录状态已失效，请重新登录')
    if (auth.mustChangePassword && !String(request.url || '').startsWith('/api/auth/password')) {
      throw new ForbiddenException('首次登录需要先修改密码')
    }
    request.auth = auth
    return true
  }
}

export function requireAuth(request: AuthenticatedRequest): NonNullable<AuthenticatedRequest['auth']> {
  if (!request.auth) throw new UnauthorizedException('登录状态已失效，请重新登录')
  return request.auth
}
