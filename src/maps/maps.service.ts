import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import { EstimateDto } from './dto/estimate.dto';

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly TOMTOM_API_KEY = process.env.TOMTOM_API_KEY;
  // 🔮 Future: move this to DB (admin-configurable)
  private readonly PRICING_CONFIG = {
    baseFare: 50,
    rideTypes: {
      'TaxiTeam Go': { perKm: 12 },
      'TaxiTeam XL': { perKm: 16 },
      'TaxiTeam XXL': { perKm: 20 },
    },
  };

  async searchPlace(query: string, limit: number) {
    console.log("searchplace",query,limit);
    try {
      const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(
        query,
      )}.json`;

      const response = await axios.get(url, {
        params: {
          key: this.TOMTOM_API_KEY,
          limit,
          countrySet: 'IN',
        },
      });

      const results = response.data?.results ?? [];

      return results.map((item: any) => {
        const title =
          item.poi?.name || item.address?.freeformAddress || 'Unknown location';

        return {
          title,
          address: item.address?.freeformAddress ?? '',
          lat: item.position?.lat,
          lng: item.position?.lon,
        };
      });
    } catch (error) {
      this.logger.error('TomTom search failed', error);
      return [];
    }
  }

  async reverseGeocode(lat: number, lng: number) {
    console.log("reversgeocode",lat,lng);
    try {
      const url = `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json`;

      const response = await axios.get(url, {
        params: {
          key: this.TOMTOM_API_KEY,
        },
      });

      const result = response.data?.addresses?.[0];

      return {
        address: result?.address?.freeformAddress ?? 'Selected location',
      };
    } catch (error) {
      this.logger.error('Reverse geocode failed', error);
      return {
        address: 'Selected location',
      };
    }
  }

  async estimate(dto: EstimateDto) {
    const route = await this.fetchRoute(dto);

    const distanceKm = Math.ceil(route.distanceMeters / 1000);
    const durationMin = Math.ceil(route.travelTimeSeconds / 60);

    const fareByRideType = this.calculateFare(distanceKm);

    return {
      distanceKm,
      durationMin,
      routePoints: route.points,
      fareByRideType,
    };
  }

  private async fetchRoute(dto: EstimateDto) {
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${dto.pickupLat},${dto.pickupLng}:${dto.dropLat},${dto.dropLng}/json`;

    try {
      const res = await axios.get(url, {
        params: {
          key: this.TOMTOM_API_KEY,
          routeType: 'fastest',
          traffic: false, // Enable if real-time traffic is needed and live ETA, price will be fluctuated
        },
      });

      const route = res.data.routes[0];
      const summary = route.summary;
      const points = route.legs[0].points.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
      }));

      return {
        distanceMeters: summary.lengthInMeters,
        travelTimeSeconds: summary.travelTimeInSeconds,
        points,
      };
    } catch (err) {
      console.error(err.response?.data || err.message);
      throw new InternalServerErrorException('Failed to calculate route');
    }
  }

  private calculateFare(distanceKm: number) {
    const fares = {};
    const { baseFare, rideTypes } = this.PRICING_CONFIG;

    for (const [rideName, config] of Object.entries(rideTypes)) {
      fares[rideName] = Math.ceil(baseFare + distanceKm * config.perKm);
    }

    return fares;
  }
}
