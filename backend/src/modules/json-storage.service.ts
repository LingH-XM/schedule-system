import { Inject, Injectable } from '@nestjs/common'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Prisma } from '@prisma/client'
import type { DataProfile, DataResource } from './types.js'
import { DEFAULT_SCHOOL_ID } from './types.js'
import { PrismaService } from './prisma.service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '../../..')

@Injectable()
export class JsonStorageService {
  private readonly dataRoot = path.join(workspaceRoot, 'backend', 'data')
  private dbFallbackWarned = false

  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private buildPath(schoolId: string, profile: DataProfile, planId: string, resource: DataResource): string {
    return path.join(this.dataRoot, schoolId || DEFAULT_SCHOOL_ID, profile, `${planId}.${resource}.json`)
  }

  private buildLegacyPath(profile: DataProfile, planId: string, resource: DataResource): string {
    return path.join(this.dataRoot, profile, `${planId}.${resource}.json`)
  }

  async read(schoolId: string, profile: DataProfile, planId: string, resource: DataResource): Promise<Record<string, unknown>> {
    const dbPayload = await this.readFromDb(schoolId, profile, planId, resource)
    if (dbPayload) return dbPayload

    const file = this.buildPath(schoolId, profile, planId, resource)
    try {
      const raw = await fs.readFile(file, 'utf-8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        if (schoolId === DEFAULT_SCHOOL_ID) {
          try {
            const legacyRaw = await fs.readFile(this.buildLegacyPath(profile, planId, resource), 'utf-8')
            const legacyParsed = JSON.parse(legacyRaw)
            return legacyParsed && typeof legacyParsed === 'object' && !Array.isArray(legacyParsed)
              ? legacyParsed
              : {}
          } catch (legacyError) {
            const legacyCode =
              typeof legacyError === 'object' && legacyError && 'code' in legacyError ? String(legacyError.code) : ''
            if (legacyCode === 'ENOENT') return {}
            throw legacyError
          }
        }
        return {}
      }
      throw error
    }
  }

  async write(schoolId: string, profile: DataProfile, planId: string, resource: DataResource, payload: Record<string, unknown>): Promise<void> {
    const wroteDb = await this.writeToDb(schoolId, profile, planId, resource, payload)
    if (wroteDb) return

    const file = this.buildPath(schoolId, profile, planId, resource)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
  }

  private async readFromDb(
    schoolId: string,
    profile: DataProfile,
    planId: string,
    resource: DataResource
  ): Promise<Record<string, unknown> | null> {
    if (!this.prismaService.isEnabled()) return null
    const prisma = await this.prismaService.getClient()
    if (!prisma) return null

    try {
      const row = await prisma.snapshot.findUnique({
        where: { schoolId_profile_planId_resource: { schoolId, profile, planId, resource } },
        select: { payload: true }
      })
      if (!row) return null
      const payload = row.payload
      return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    } catch (error) {
      this.warnDbFallback(error)
      return null
    }
  }

  private async writeToDb(
    schoolId: string,
    profile: DataProfile,
    planId: string,
    resource: DataResource,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.prismaService.isEnabled()) return false
    const prisma = await this.prismaService.getClient()
    if (!prisma) return false

    try {
      if (prisma.account?.upsert) {
        await prisma.account.upsert({
          where: { schoolId },
          update: { lastActiveAt: new Date() },
          create: { schoolId, name: schoolId, lastActiveAt: new Date() }
        })
      }
      await prisma.snapshot.upsert({
        where: { schoolId_profile_planId_resource: { schoolId, profile, planId, resource } },
        update: { payload: payload as Prisma.InputJsonValue, savedAt: this.toSavedAtDate(payload) },
        create: { schoolId, profile, planId, resource, payload: payload as Prisma.InputJsonValue, savedAt: this.toSavedAtDate(payload) }
      })
      return true
    } catch (error) {
      this.warnDbFallback(error)
      return false
    }
  }

  private toSavedAtDate(payload: Record<string, unknown>): Date {
    const savedAt = payload._savedAt
    if (typeof savedAt === 'number' && Number.isFinite(savedAt)) {
      return new Date(savedAt)
    }
    return new Date()
  }

  private warnDbFallback(error: unknown): void {
    if (this.dbFallbackWarned) return
    this.dbFallbackWarned = true
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[storage] Prisma unavailable, fallback to file storage: ${message}`)
  }
}
