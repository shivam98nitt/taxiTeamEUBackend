import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';

export class CreateRideDto {
  @IsNumber()
  riderId: number;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsString()
  @IsNotEmpty()
  pickupAddress: string;

  @IsNumber()
  dropLat: number;

  @IsNumber()
  dropLng: number;

  @IsString()
  @IsNotEmpty()
  dropAddress: string;

  @IsString()
  @IsIn(['GO', 'XL', 'XXL'])
  vehicleType: string;

  @IsInt()
  @Min(1)
  distanceKm: number;

  @IsInt()
  @Min(1)
  durationMin: number;

  @IsInt()
  @Min(1)
  estimatedFare: number;
}
