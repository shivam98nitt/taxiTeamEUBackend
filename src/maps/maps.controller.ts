import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MapsService } from './maps.service';
import { SearchPlaceDto } from './dto/search-place.dto';
import { ReverseGeocodeDto } from './dto/reverse-geocode.dto';
import { EstimateDto } from './dto/estimate.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Get('search')
  async search(@Query() queryDto: SearchPlaceDto) {
    const query = queryDto.query?.trim();

    if (!query || query.length < 3) {
      return [];
    }

    return this.mapsService.searchPlace(query, queryDto.limit ?? 6);
  }

  @Post('reverse-geocode')
  async reverseGeocode(@Body() body: ReverseGeocodeDto) {
    return this.mapsService.reverseGeocode(body.lat, body.lng);
  }

  @Post('estimate')
  async estimateRide(@Body() dto: EstimateDto) {
    return this.mapsService.estimate(dto);
  }
}
