import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AuthGuard } from './auth.guard.js'
import { BasicDataController } from './basic-data.controller.js'
import { RuleSettingsController } from './rule-settings.controller.js'
import { ScheduleStateController } from './schedule-state.controller.js'
import { SmartSchedulerController } from './smart-scheduler.controller.js'
import { SystemController } from './system.controller.js'
import { JsonStorageService } from './json-storage.service.js'
import { PrismaService } from './prisma.service.js'
import { SmartSchedulerService } from './smart-scheduler.service.js'
import { SmartSchedulerQueueService } from './smart-scheduler-queue.service.js'
import { StructuredDataSyncService } from './structured-data-sync.service.js'
import { DataScopeService } from './data-scope.service.js'
import { SchoolFeaturesController } from './school-features.controller.js'
import { SchoolFeaturesService } from './school-features.service.js'
import { HealthController } from './health.controller.js'
import { MailService } from './mail.service.js'

@Module({
  controllers: [AuthController, BasicDataController, RuleSettingsController, ScheduleStateController, SmartSchedulerController, SystemController, SchoolFeaturesController, HealthController],
  providers: [AuthService, AuthGuard, DataScopeService, JsonStorageService, MailService, PrismaService, SmartSchedulerService, SmartSchedulerQueueService, StructuredDataSyncService, SchoolFeaturesService]
})
export class AppModule {}
