import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriverBehaviorService } from './driver-behaviour.services';

@Module({
  providers: [DriversService, DriverBehaviorService],
})
export class DriversModule {}
