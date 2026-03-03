import 'reflect-metadata'
import { createRequire } from 'node:module'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './modules/app.module.js'

const require = createRequire(import.meta.url)
const expressAny = require('express') as {
  json: (options?: Record<string, unknown>) => (req: unknown, res: unknown, next: unknown) => void
  urlencoded: (options?: Record<string, unknown>) => (req: unknown, res: unknown, next: unknown) => void
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false })
  const host = process.env.API_HOST || '127.0.0.1'
  const port = Number(process.env.API_PORT || 8787)
  const origin = process.env.API_CORS_ORIGIN || '*'
  const bodyLimit = process.env.API_BODY_LIMIT || '2mb'

  app.use(expressAny.json({ limit: bodyLimit }))
  app.use(expressAny.urlencoded({ limit: bodyLimit, extended: true }))

  app.enableCors({
    origin,
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  })

  await app.listen(port, host)
  const logger = new Logger('Bootstrap')
  logger.log(`Nest API started at http://${host}:${port}`)
  logger.log('Scoped routes: /api/test/* and /api/prod/*')
}

void bootstrap()
