import { IsNumber } from 'class-validator';

export class AcceptRideDto {
  @IsNumber()
  rideId: number;

  @IsNumber()
  driverId: number;
}
