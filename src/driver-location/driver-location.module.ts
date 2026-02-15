// src/driver-location/driver-location.module.ts
import { Module } from '@nestjs/common';
import { DriverLocationService } from './driver-location.service';
import { DatabaseService } from 'src/database/database.service';

@Module({
  providers: [DriverLocationService, DatabaseService],
  exports: [DriverLocationService],
})
export class DriverLocationModule {}
