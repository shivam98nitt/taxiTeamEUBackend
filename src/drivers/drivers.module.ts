import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';

@Module({
  providers: [DriversService],
})
export class DriversModule {}
