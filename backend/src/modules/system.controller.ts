import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common'
import { PrismaService } from './prisma.service.js'
import { normalizeProfile, sanitizeAccountId } from './types.js'

@Controller()
export class SystemController {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  @Get('/api/:profile/system/health')
  async getHealth(@Param('profile') profileParam: string, @Query('accountId') accountIdParam?: string) {
    if (!['test', 'prod'].includes(String(profileParam || '').toLowerCase())) {
      throw new BadRequestException('profile must be test or prod')
    }
    const profile = normalizeProfile(profileParam)
    const accountId = sanitizeAccountId(accountIdParam)
    const prismaEnabled = this.prismaService.isEnabled()

    if (!prismaEnabled) {
      return {
        ok: true,
        accountId,
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
        accountId,
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
          accountId_profile_planId_resource: {
            accountId,
            profile,
            planId: 'default',
            resource: 'basic-data'
          }
        },
        select: { id: true }
      })
      return {
        ok: true,
        accountId,
        profile,
        prismaEnabled: true,
        prismaConnected: true,
        storageMode: 'database',
        message: '数据库连接正常。'
      }
    } catch (error) {
      return {
        ok: true,
        accountId,
        profile,
        prismaEnabled: true,
        prismaConnected: false,
        storageMode: 'file-fallback',
        message: `数据库不可用，当前为文件存储：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}
