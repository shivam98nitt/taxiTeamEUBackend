import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { DriverBehaviorService } from 'src/drivers/driver-behaviour.services';

@Injectable()
export class DispatchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notificationsService: NotificationsService,
    private readonly driverBehaviorService: DriverBehaviorService,
  ) {}

  async handleDriverAccept(driverId: number, rideId: number) {
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      // lock ride
      const rideRes = await client.query(
        `SELECT status, rider_id FROM rides WHERE id = $1 FOR UPDATE`,
        [rideId],
      );

      if (!rideRes.rows.length) throw new Error('Ride not found');

      const ride = rideRes.rows[0];

      if (ride.status !== 'SEARCHING_DRIVER') {
        throw new Error('Ride no longer available');
      }

      // lock dispatch row
      const dispatchRes = await client.query(
        `
        SELECT id FROM ride_driver_dispatch
        WHERE ride_id = $1
        AND driver_id = $2
        AND status = 'REQUESTED'
        FOR UPDATE
        `,
        [rideId, driverId],
      );

      if (!dispatchRes.rows.length) {
        throw new Error('No valid dispatch row');
      }

      // update dispatch
      await client.query(
        `
        UPDATE ride_driver_dispatch
        SET status = 'ACCEPTED',
            responded_at = NOW()
        WHERE ride_id = $1
        AND driver_id = $2
        AND status = 'REQUESTED'
        `,
        [rideId, driverId],
      );

      // update ride
      await client.query(
        `
        UPDATE rides
        SET driver_id = $1,
            status = 'DRIVER_ASSIGNED'
        WHERE id = $2
        `,
        [driverId, rideId],
      );

      // update driver flags
      await client.query(
        `
        UPDATE drivers
        SET has_pending_request = false,
            is_available = false
        WHERE id = $1
        `,
        [driverId],
      );

      // insert event
      await client.query(
        `
        INSERT INTO ride_events (ride_id, actor, event_type, meta)
        VALUES ($1, 'DRIVER', 'DRIVER_ACCEPTED', $2)
        `,
        [
          rideId,
          JSON.stringify({
            driverId,
            acceptedAt: new Date().toISOString(),
          }),
        ],
      );

      await client.query('COMMIT');

      // notify rider
      this.notificationsService.notifyRider(
        ride.rider_id,
        'RIDE_ASSIGNED',
        { rideId, driverId },
      );

      // behavior hook
      this.driverBehaviorService.recordDriverAccepted(driverId, rideId);

      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
