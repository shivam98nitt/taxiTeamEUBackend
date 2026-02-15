import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Param,
  Get,
} from '@nestjs/common';
import { RideService } from './ride.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { StartTripDto } from './dto/start-trip.dto';

@Controller('ride')
export class RideController {
  constructor(private readonly rideService: RideService) { }

  @Get(':rideId')
  @UseGuards(JwtAuthGuard)
  async getRideDetails(@Req() req, @Param('rideId') rideId: number) {
    const userId = req.user.userId; // from JWT
    return this.rideService.getRideDetails(userId, rideId);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createRide(@Req() req, @Body() body) {
    const riderId = req.user.userId; // from JWT
    return this.rideService.createRide(riderId, body);
  }

  @Post('accept')
  @UseGuards(JwtAuthGuard)
  async acceptRide(@Req() req, @Body() body: { rideId: number }) {
    const driverId = req.user.userId; // from JWT

    return this.rideService.handleDriverAccept(driverId, body.rideId);
  }

  // 🚘 Phase 6 — Driver arrived at pickup
  @Post('arrived')
  @UseGuards(JwtAuthGuard)
  async markArrived(@Req() req, @Body() body: { rideId: number }) {
    const driverId = req.user.userId; // from JWT

    return this.rideService.markDriverArrived(driverId, body.rideId);
  }

  // 🧍 Phase 7 — Start trip with OTP verification
  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startTrip(@Req() req, @Body() body: StartTripDto) {
    const driverId = req.user.userId; // from JWT

    return this.rideService.startTrip(driverId, body.rideId, body.otpCode);
  }

  // 🏁 Phase 8 — Complete trip
  @Post('complete')
  @UseGuards(JwtAuthGuard)
  async completeTrip(@Req() req, @Body() body: { rideId: number; finalFare?: number }) {
    const driverId = req.user.userId; // from JWT

    return this.rideService.completeTrip(driverId, body.rideId, body.finalFare);
  }

  // ❌ Phase 9 — Cancel ride
  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  async cancelRide(@Req() req, @Body() body: { rideId: number }) {
    const userId = req.user.userId; // from JWT
    const role = req.user.role; // from JWT

    if (role === 'DRIVER') {
      return this.rideService.cancelRideByDriver(userId, body.rideId);
    } else {
      return this.rideService.cancelRideByRider(userId, body.rideId);
    }
  }
}


