import { IsNumber } from 'class-validator';

export class ReverseGeocodeDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}
