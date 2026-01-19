import { IsOptional, IsString, MinLength } from 'class-validator';

export class SearchPlaceDto {
  @IsString()
  @MinLength(3)
  query: string;

  @IsOptional()
  limit?: number;
}
