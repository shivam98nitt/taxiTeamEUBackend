import { Module } from '@nestjs/common';
import { RideController } from './ride.controller';
import { RideService } from './ride.service';
import { DatabaseService } from 'src/database/database.service';
import { AuthModule } from 'src/auth/auth.module';
import { DriverLocationModule } from 'src/driver-location/driver-location.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { DriverBehaviorService } from 'src/drivers/driver-behaviour.services';
import { SocketModule } from 'src/socket/socket.module';

@Module({
  controllers: [RideController],
  providers: [RideService, DatabaseService, DriverBehaviorService],
  imports: [AuthModule, DriverLocationModule, NotificationsModule, SocketModule],
  exports: [RideService],
})
export class RideModule {}
