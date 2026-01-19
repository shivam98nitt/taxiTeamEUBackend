import { Controller, Post, Body, Param } from '@nestjs/common';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { AcceptRideDto } from './dto/accept-ride.dto';

@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) { }

  @Post()
  createRide(@Body() dto: CreateRideDto) {
    return this.ridesService.createRide(dto);
  }

  @Post('accept')
  acceptRide(@Body() dto: AcceptRideDto) {
    return this.ridesService.acceptRide(dto);
  }

}
