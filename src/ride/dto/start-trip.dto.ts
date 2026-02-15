import { IsNumber, IsString, Length } from 'class-validator';

export class StartTripDto {
  @IsNumber()
  rideId: number;

  @IsString()
  @Length(4, 4, { message: 'OTP must be exactly 4 digits' })
  otpCode: string;
}
