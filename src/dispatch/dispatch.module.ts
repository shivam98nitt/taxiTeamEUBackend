import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { DatabaseService } from 'src/database/database.service';
import { DriverBehaviorService } from 'src/drivers/driver-behaviour.services';

@Module({
  imports: [NotificationsModule],
  providers: [DispatchService, DatabaseService, DriverBehaviorService],
  exports: [DispatchService],
})
export class DispatchModule {}
