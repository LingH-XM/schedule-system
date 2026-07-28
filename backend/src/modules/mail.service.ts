import { Injectable } from '@nestjs/common'
import nodemailer, { type Transporter } from 'nodemailer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PasswordResetMail = {
  to: string
  name: string
  token: string
}

@Injectable()
export class MailService {
  private transporter: Transporter | null = null

  isConfigured(): boolean {
    return Boolean(
      readSetting('SMTP_HOST') &&
      readSetting('SMTP_USER') &&
      readSetting('SMTP_PASSWORD')
    )
  }

  async sendPasswordResetEmail(input: PasswordResetMail): Promise<void> {
    const transporter = this.getTransporter()
    const publicUrl = requireSetting('APP_PUBLIC_URL').replace(/\/+$/, '')
    const resetUrl = `${publicUrl}/password-reset?token=${encodeURIComponent(input.token)}`
    const from = readSetting('SMTP_FROM') || requireSetting('SMTP_USER')
    const displayName = escapeHtml(input.name || '用户')

    await transporter.sendMail({
      from: `"排课系统" <${from}>`,
      to: input.to,
      subject: '重置排课系统登录密码',
      text: [
        `${input.name || '您好'}：`,
        '',
        '你正在重置排课系统登录密码，请在 30 分钟内打开下面的链接完成操作：',
        resetUrl,
        '',
        '如果这不是你的操作，请忽略本邮件。该链接只能使用一次。'
      ].join('\n'),
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#24324a;line-height:1.7;max-width:560px;margin:auto">
          <h2 style="margin:0 0 16px">重置登录密码</h2>
          <p>${displayName}，你好：</p>
          <p>请在 30 分钟内点击下方按钮重置排课系统登录密码。该链接只能使用一次。</p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:#3f6fbf;color:#fff;text-decoration:none">重置密码</a>
          </p>
          <p style="font-size:13px;color:#5f6f8a">如果按钮无法打开，请复制此地址到浏览器：<br>${escapeHtml(resetUrl)}</p>
          <p style="font-size:13px;color:#5f6f8a">如果这不是你的操作，请忽略本邮件。</p>
        </div>
      `
    })
  }

  private getTransporter(): Transporter {
    if (!this.isConfigured()) throw new Error('SMTP is not configured')
    if (this.transporter) return this.transporter

    const port = Number(readSetting('SMTP_PORT') || 465)
    const secureSetting = readSetting('SMTP_SECURE')
    const secure = secureSetting
      ? secureSetting.toLowerCase() === 'true'
      : port === 465

    this.transporter = nodemailer.createTransport({
      host: requireSetting('SMTP_HOST'),
      port,
      secure,
      auth: {
        user: requireSetting('SMTP_USER'),
        pass: requireSetting('SMTP_PASSWORD')
      }
    })
    return this.transporter
  }
}

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const backendEnvFiles = [
  path.join(backendDirectory, '.env'),
  path.join(backendDirectory, '.env.smtp')
]
let envFileCache: Map<string, string> | null = null

function readSetting(key: string): string {
  const fromProcess = String(process.env[key] || '').trim()
  if (fromProcess) return fromProcess
  if (!envFileCache) {
    envFileCache = new Map()
    for (const envFile of backendEnvFiles) {
      if (fs.existsSync(envFile)) {
        for (const rawLine of fs.readFileSync(envFile, 'utf8').split('\n')) {
          const line = rawLine.trim()
          if (!line || line.startsWith('#')) continue
          const separator = line.indexOf('=')
          if (separator < 1) continue
          const envKey = line.slice(0, separator).trim()
          const envValue = line.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
          envFileCache.set(envKey, envValue)
        }
      }
    }
  }
  return String(envFileCache.get(key) || '').trim()
}

function requireSetting(key: string): string {
  const value = readSetting(key)
  if (!value) throw new Error(`${key} is not configured`)
  return value
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
