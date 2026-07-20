import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
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

@Module({
  controllers: [AuthController, BasicDataController, RuleSettingsController, ScheduleStateController, SmartSchedulerController, SystemController],
  providers: [AuthService, JsonStorageService, PrismaService, SmartSchedulerService, SmartSchedulerQueueService, StructuredDataSyncService]
})
export class AppModule {}
