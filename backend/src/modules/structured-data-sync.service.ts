import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service.js'
import type { DataProfile } from './types.js'

type TeacherRecord = {
  id?: unknown
  name?: unknown
  campusId?: unknown
  subject?: unknown
  subjectGroup?: unknown
}

type CourseItem = {
  id?: unknown
  name?: unknown
  shortName?: unknown
  subject?: unknown
  scopes?: unknown
  campusId?: unknown
}

type ClassRecord = {
  id?: unknown
  campusId?: unknown
  stage?: unknown
  grade?: unknown
  classNo?: unknown
  className?: unknown
}

type TeachingAssignmentRecord = {
  id?: unknown
  campusId?: unknown
  grade?: unknown
  classId?: unknown
  teacherId?: unknown
  courseId?: unknown
  weeklyLessons?: unknown
}

@Injectable()
export class StructuredDataSyncService {
  private warned = false

  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  async syncBasicData(accountId: string, profile: DataProfile, planId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.prismaService.isEnabled()) return
    const prisma = await this.prismaService.getClient()
    if (!prisma) return

    const teachers = this.normalizeTeachers(payload.teacherRecords).map((item) => ({ ...item, accountId, profile, planId }))
    const courses = this.normalizeCourses(payload.courses).map((item) => ({ ...item, accountId, profile, planId }))
    const classes = this.normalizeClasses(payload.classRecords).map((item) => ({ ...item, accountId, profile, planId }))
    const teacherIdSet = new Set(teachers.map((item) => item.teacherId))
    const courseIdSet = new Set(courses.map((item) => item.courseId))
    const classIdSet = new Set(classes.map((item) => item.classId))

    const assignments = this.normalizeTeachingAssignments(payload.teachingAssignments)
      .filter(
        (item) => teacherIdSet.has(item.teacherId) && courseIdSet.has(item.courseId) && classIdSet.has(item.classId)
      )
      .map((item) => ({
      ...item,
      accountId,
      profile,
      planId
    }))

    try {
      await prisma.$transaction([
        prisma.teachingAssignment.deleteMany({ where: { accountId, profile, planId } }),
        prisma.teacher.deleteMany({ where: { accountId, profile, planId } }),
        prisma.course.deleteMany({ where: { accountId, profile, planId } }),
        prisma.schoolClass.deleteMany({ where: { accountId, profile, planId } }),
        prisma.teacher.createMany({ data: teachers, skipDuplicates: true }),
        prisma.course.createMany({ data: courses, skipDuplicates: true }),
        prisma.schoolClass.createMany({ data: classes, skipDuplicates: true }),
        prisma.teachingAssignment.createMany({ data: assignments, skipDuplicates: true })
      ])
    } catch (error) {
      if (!this.warned) {
        this.warned = true
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[structured-sync] failed, snapshot still saved: ${message}`)
      }
    }
  }

  private normalizeTeachers(input: unknown): Array<{
    teacherId: string
    name: string
    campusId: string
    subject: string
    subjectGroup: string
  }> {
    const records = Array.isArray(input) ? (input as TeacherRecord[]) : []
    return records
      .map((item) => ({
        teacherId: this.toStr(item.id),
        name: this.toStr(item.name),
        campusId: this.toStr(item.campusId),
        subject: this.toStr(item.subject),
        subjectGroup: this.toStr(item.subjectGroup)
      }))
      .filter((item) => Boolean(item.teacherId && item.name))
  }

  private normalizeCourses(input: unknown): Array<{
    courseId: string
    name: string
    shortName: string
    subject: string
    scopes: unknown
    campusId: string
  }> {
    const records = Array.isArray(input) ? (input as CourseItem[]) : []
    return records
      .map((item) => ({
        courseId: this.toStr(item.id),
        name: this.toStr(item.name),
        shortName: this.toStr(item.shortName),
        subject: this.toStr(item.subject),
        scopes: Array.isArray(item.scopes) ? item.scopes : [],
        campusId: this.toStr(item.campusId)
      }))
      .filter((item) => Boolean(item.courseId && item.name))
  }

  private normalizeClasses(input: unknown): Array<{
    classId: string
    campusId: string
    stage: string
    grade: string
    classNo: number
    className: string
  }> {
    const records = Array.isArray(input) ? (input as ClassRecord[]) : []
    return records
      .map((item) => ({
        classId: this.toStr(item.id),
        campusId: this.toStr(item.campusId),
        stage: this.toStr(item.stage),
        grade: this.toStr(item.grade),
        classNo: this.toInt(item.classNo),
        className: this.toStr(item.className)
      }))
      .filter((item) => Boolean(item.classId && item.className))
  }

  private normalizeTeachingAssignments(input: unknown): Array<{
    assignmentId: string
    campusId: string
    grade: string
    weeklyLessons: number
    classId: string
    teacherId: string
    courseId: string
  }> {
    const records = Array.isArray(input) ? (input as TeachingAssignmentRecord[]) : []
    return records
      .map((item) => ({
        assignmentId: this.toStr(item.id),
        campusId: this.toStr(item.campusId),
        grade: this.toStr(item.grade),
        weeklyLessons: this.toInt(item.weeklyLessons),
        classId: this.toStr(item.classId),
        teacherId: this.toStr(item.teacherId),
        courseId: this.toStr(item.courseId)
      }))
      .filter((item) => Boolean(item.assignmentId && item.classId && item.teacherId && item.courseId))
  }

  private toStr(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  private toInt(value: unknown): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.floor(n))
  }
}
