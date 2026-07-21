import { BadRequestException, Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, requireAuth } from './auth.guard.js'
import type { AuthenticatedRequest } from './auth.types.js'
import { PrismaService } from './prisma.service.js'
import { normalizeProfile } from './types.js'

@Controller()
@UseGuards(AuthGuard)
export class SystemController {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  @Get('/api/:profile/system/health')
  async getHealth(@Req() request: AuthenticatedRequest, @Param('profile') profileParam: string) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const schoolId = requireAuth(request).schoolId
    const prismaEnabled = this.prismaService.isEnabled()

    if (!prismaEnabled) {
      return {
        ok: true,
        schoolId,
        profile,
        prismaEnabled: false,
        prismaConnected: false,
        storageMode: 'file-fallback',
        message: 'DATABASE_URL 未配置，当前为文件存储。'
      }
    }

    const client = await this.prismaService.getClient()
    if (!client) {
      return {
        ok: true,
        schoolId,
        profile,
        prismaEnabled: true,
        prismaConnected: false,
        storageMode: 'file-fallback',
        message: 'Prisma 初始化失败，当前为文件存储。'
      }
    }

    try {
      await client.snapshot.findUnique({
        where: {
          schoolId_profile_planId_resource: {
            schoolId,
            profile,
            planId: 'default',
            resource: 'basic-data'
          }
        },
        select: { id: true }
      })
      return {
        ok: true,
        schoolId,
        profile,
        prismaEnabled: true,
        prismaConnected: true,
        storageMode: 'database',
        message: '数据库连接正常。'
      }
    } catch (error) {
      return {
        ok: true,
        schoolId,
        profile,
        prismaEnabled: true,
        prismaConnected: false,
        storageMode: 'file-fallback',
        message: `数据库不可用，当前为文件存储：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}
