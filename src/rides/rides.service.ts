import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from 'src/database/database.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { AcceptRideDto } from './dto/accept-ride.dto';
import { DISPATCH_CONFIG } from 'src/common/config/dispatch.config';

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly db: DatabaseService,
  ) {}

  /* ---------------- CREATE RIDE ---------------- */
  async createRide(dto: CreateRideDto) {
    const result = await this.db.query(
      `
      INSERT INTO rides (
        rider_id,
        pickup_lat, pickup_lng, pickup_address,
        drop_lat, drop_lng, drop_address,
        vehicle_type,
        distance_km,
        duration_min,
        estimated_fare,
        status
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        $8,
        $9,$10,$11,
        'SEARCHING_DRIVER'
      )
      RETURNING *
      `,
      [
        dto.riderId,
        dto.pickupLat,
        dto.pickupLng,
        dto.pickupAddress,
        dto.dropLat,
        dto.dropLng,
        dto.dropAddress,
        dto.vehicleType,
        dto.distanceKm,
        dto.durationMin,
        dto.estimatedFare,
      ],
    );

    
    this.dispatchRide(result.rows[0].id).catch(err => {
      this.logger.error(
        `Failed to dispatch ride ${result.rows[0].id}: ${err.message}`,
      );
    });
    return result.rows[0];
  }

  /* ---------------- ACCEPT RIDE ---------------- */
  async acceptRide(dto: AcceptRideDto) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      const rideRes = await client.query(
        `SELECT * FROM rides WHERE id = $1 FOR UPDATE`,
        [dto.rideId],
      );

      const ride = rideRes.rows[0];
      if (!ride || ride.status !== 'SEARCHING_DRIVER') {
        throw new Error('Ride not available');
      }

      const driverRes = await client.query(
        `
        SELECT * FROM drivers
        WHERE id = $1
          AND has_pending_request = true
          AND pending_ride_id = $2
        FOR UPDATE
        `,
        [dto.driverId, dto.rideId],
      );

      if (!driverRes.rows.length) {
        throw new Error('Invalid driver request');
      }

      await client.query(
        `
        UPDATE rides
        SET driver_id = $1,
            status = 'DRIVER_ASSIGNED'
        WHERE id = $2
        `,
        [dto.driverId, dto.rideId],
      );

      await client.query(
        `
        UPDATE drivers
        SET is_available = false,
            has_pending_request = false,
            pending_ride_id = NULL
        WHERE id = $1
        `,
        [dto.driverId],
      );

      await client.query(
        `
        UPDATE drivers
        SET has_pending_request = false,
            pending_ride_id = NULL
        WHERE pending_ride_id = $1
          AND id <> $2
        `,
        [dto.rideId, dto.driverId],
      );

      await client.query('COMMIT');
      return { success: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /* ---------------- DISPATCH LOGIC ---------------- */
  async dispatchRide(rideId: number): Promise<void> {
    let radiusKm = DISPATCH_CONFIG.initialRadiusKm;

    await this.db.query(
      `UPDATE rides SET status = 'DISPATCHING' WHERE id = $1`,
      [rideId],
    );

    while (radiusKm <= DISPATCH_CONFIG.maxRadiusKm) {
      this.logger.log(
        `Dispatching ride ${rideId} | radius=${radiusKm}km`,
      );

      const drivers = await this.findEligibleDrivers(
        rideId,
        radiusKm,
      );

      if (!drivers.length) {
        radiusKm += DISPATCH_CONFIG.incrementRadiusKm;
        continue;
      }

      const batch = drivers.slice(0, DISPATCH_CONFIG.batchSize);

      await this.sendRideRequests(rideId, batch);

      const accepted = await this.waitForAcceptance(
        rideId,
        DISPATCH_CONFIG.responseTimeoutSec,
      );

      if (accepted) return;

      await this.resetDrivers(batch);
      radiusKm += DISPATCH_CONFIG.incrementRadiusKm;
    }

    await this.failRide(rideId);
  }

  /* ---------------- DRIVER MATCHING ---------------- */
  async findEligibleDrivers(
    rideId: number,
    radiusKm: number,
  ) {
    const rideRes = await this.db.query(
      `SELECT * FROM rides WHERE id = $1`,
      [rideId],
    );

    if (!rideRes.rows.length) {
      throw new InternalServerErrorException('Ride not found');
    }

    const ride = rideRes.rows[0];

    const driversRes = await this.db.query(
      `
      SELECT id, current_lat, current_lng
      FROM drivers
      WHERE is_online = true
        AND is_available = true
        AND has_pending_request = false
        AND vehicle_type = $1
      `,
      [ride.vehicle_type],
    );

    const eligible : { driverId: number; distanceKm: number; etaMin: number }[] = [];

    for (const d of driversRes.rows) {
      try {
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${d.current_lat},${d.current_lng}:${ride.pickup_lat},${ride.pickup_lng}/json`;

        const { data } = await axios.get(url, {
          params: {
            key: process.env.TOMTOM_API_KEY,
            traffic: false,
          },
        });

        const summary = data.routes[0].summary;
        const distanceKm = summary.lengthInMeters / 1000;

        if (distanceKm <= radiusKm) {
          eligible.push({
            driverId: d.id,
            distanceKm: Math.ceil(distanceKm),
            etaMin: Math.ceil(
              summary.travelTimeInSeconds / 60,
            ),
          });
        }
      } catch {
        // Ignore this driver
        continue;
      }
    }

    return eligible;
  }

  /* ---------------- HELPERS ---------------- */
  private async sendRideRequests(rideId: number, drivers: any[]) {
    for (const d of drivers) {
      const res = await this.db.query(
        `
        UPDATE drivers
        SET has_pending_request = true,
            pending_ride_id = $1
        WHERE id = $2
          AND is_available = true
          AND has_pending_request = false
        `,
        [rideId, d.driverId],
      );

      if (res.rowCount) {
        this.notifyDriver(d.driverId, rideId);
      }
    }
  }

  private notifyDriver(driverId: number, rideId: number) {
    this.logger.log(
      `📢 Ride request → driver=${driverId}, ride=${rideId}`,
    );
  }

  private async waitForAcceptance(
    rideId: number,
    timeoutSec: number,
  ): Promise<boolean> {
    const end = Date.now() + timeoutSec * 1000;

    while (Date.now() < end) {
      const res = await this.db.query(
        `SELECT driver_id FROM rides WHERE id = $1`,
        [rideId],
      );

      if (res.rows[0]?.driver_id) return true;

      await new Promise(r => setTimeout(r, 1000));
    }

    return false;
  }

  private async resetDrivers(drivers: any[]) {
    const ids = drivers.map(d => d.driverId);

    await this.db.query(
      `
      UPDATE drivers
      SET has_pending_request = false,
          pending_ride_id = NULL
      WHERE id = ANY($1)
      `,
      [ids],
    );
  }

  private async failRide(rideId: number) {
    await this.db.query(
      `
      UPDATE rides
      SET status = 'NO_DRIVER_FOUND'
      WHERE id = $1
      `,
      [rideId],
    );
  }
}
