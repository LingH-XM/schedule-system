import { Injectable, OnModuleDestroy } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '@prisma/client'

type PrismaLikeClient = PrismaClient

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '../../..')

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly databaseUrl: string | null
  private readonly enabled: boolean
  private client: PrismaLikeClient | null = null
  private initError = false
  private initPromise: Promise<PrismaLikeClient | null> | null = null

  constructor() {
    this.databaseUrl = this.resolveDatabaseUrl()
    this.enabled = Boolean(this.databaseUrl)
    if (this.databaseUrl && !process.env.DATABASE_URL) {
      process.env.DATABASE_URL = this.databaseUrl
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async getClient(): Promise<PrismaLikeClient | null> {
    if (!this.enabled || this.initError) return null
    if (this.client) return this.client
    if (!this.initPromise) {
      this.initPromise = (new Function('return import("@prisma/client")')() as Promise<{ PrismaClient: new () => PrismaLikeClient }>)
        .then((mod) => {
          this.client = new mod.PrismaClient()
          return this.client
        })
        .catch(() => {
          this.initError = true
          return null
        })
    }
    return this.initPromise
  }

  getClientSync(): PrismaLikeClient | null {
    return this.client
  }

  private resolveDatabaseUrl(): string | null {
    const fromEnv = String(process.env.DATABASE_URL || '').trim()
    if (fromEnv) return fromEnv
    const envFile = path.join(workspaceRoot, 'backend', '.env')
    if (!fs.existsSync(envFile)) return null
    const raw = fs.readFileSync(envFile, 'utf-8')
    const line = raw
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.startsWith('DATABASE_URL='))
    if (!line) return null
    const value = line.slice('DATABASE_URL='.length).trim()
    if (!value) return null
    return value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client || (await this.getClient())
    if (!client) return
    await client.$disconnect()
  }
}
