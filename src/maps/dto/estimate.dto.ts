import { IsNumber } from 'class-validator';

export class EstimateDto {
  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsNumber()
  dropLat: number;

  @IsNumber()
  dropLng: number;
}
