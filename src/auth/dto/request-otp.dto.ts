import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+[1-9]\d{9,14}$/, {
    message: 'Phone number must be in E.164 format (e.g. +918707201817)',
  })
  phone: string;
}
