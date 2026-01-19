import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+[1-9]\d{9,14}$/, {
    message: 'Phone number must be in E.164 format (e.g. +918707201817)',
  })
  phone: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[0-9]{4,6}$/, {
    message: 'OTP must be 4–6 digits',
  })
  otp: string;
}
