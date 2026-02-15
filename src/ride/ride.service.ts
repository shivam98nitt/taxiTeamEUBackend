import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { DriverLocationService } from 'src/driver-location/driver-location.service';
import { DriverBehaviorService } from 'src/drivers/driver-behaviour.services';
import { NotificationsService } from 'src/notifications/notifications.service';
import { SocketGateway } from 'src/socket/socket.gateway';
import { DISPATCH_CONFIG } from 'src/common/config/dispatch.config';

interface OtpRecord {
    otp: string;
    riderId: number;
    driverId: number;
    generatedAt: Date;
    expiresAt: Date;
}

@Injectable()
export class RideService {
    private readonly logger = new Logger(RideService.name);
    private readonly OTP_EXPIRY_SECONDS = 300; // 5 minutes
    private readonly OTP_LENGTH = 4;

    constructor(
        private readonly db: DatabaseService,
        private readonly driverLocationService: DriverLocationService,
        private readonly notificationsService: NotificationsService,
        private readonly driverBehaviorService: DriverBehaviorService,
        private readonly socketGateway: SocketGateway,
    ) { }

    private dispatchTimers = new Map<number, NodeJS.Timeout>();
    private dispatchDriverLists = new Map<number, number[]>();
    private dispatchIndexes = new Map<number, number>();
    private otpStore = new Map<number, OtpRecord>(); // rideId -> OtpRecord

    /**
     * Generate a random 4-digit OTP
     */
    private generateOtp(): string {
        const otp = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(this.OTP_LENGTH, '0');
        return otp;
    }

    /**
     * Store OTP in memory with expiry
     */
    private storeOtp(rideId: number, otp: string, riderId: number, driverId: number): { otp: string; expiresIn: number } {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.OTP_EXPIRY_SECONDS * 1000);
        const expiresIn = this.OTP_EXPIRY_SECONDS;

        this.otpStore.set(rideId, {
            otp,
            riderId,
            driverId,
            generatedAt: now,
            expiresAt,
        });

        return { otp, expiresIn };
    }

    /**
     * Validate OTP for a ride
     */
    private validateOtp(rideId: number, otpCode: string): { valid: boolean; error?: string } {
        const record = this.otpStore.get(rideId);

        if (!record) {
            return { valid: false, error: 'No OTP found for this ride' };
        }

        if (new Date() > record.expiresAt) {
            this.otpStore.delete(rideId);
            return { valid: false, error: 'OTP has expired' };
        }

        if (record.otp !== otpCode) {
            return { valid: false, error: 'Invalid OTP' };
        }

        return { valid: true };
    }

    /**
     * Remove OTP from memory
     */
    private clearOtp(rideId: number): void {
        this.otpStore.delete(rideId);
    }


    async createRide(riderId: number, body: any) {
        // 1️⃣ Check active ride

        const activeRide = await this.db.query(
            `
      SELECT id FROM rides
      WHERE rider_id = $1
      AND status IN (
        'SEARCHING_DRIVER',
        'DRIVER_ASSIGNED',
        'DRIVER_ARRIVING',
        'ON_TRIP'
      )
      LIMIT 1
      `,
            [riderId],
        );

        if (activeRide.rowCount > 0) {
            throw new BadRequestException(
                'You already have an active ride',
            );
        }

        // 2️⃣ Insert ride
        const rideResult = await this.db.query(
            `
      INSERT INTO rides (
        rider_id,
        pickup_lat,
        pickup_lng,
        pickup_address,
        drop_lat,
        drop_lng,
        drop_address,
        vehicle_type,
        distance_km,
        duration_min,
        estimated_fare,
        status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SEARCHING_DRIVER'
      )
      RETURNING id
      `,
            [
                riderId,
                body.pickup_lat,
                body.pickup_lng,
                body.pickup_address,
                body.drop_lat,
                body.drop_lng,
                body.drop_address,
                body.vehicle_type,
                body.distance_km,
                body.duration_min,
                body.estimated_fare,
            ],
        );

        const rideId = rideResult.rows[0].id;

        // 3️⃣ Insert event
        await this.db.query(
            `
      INSERT INTO ride_events (
        ride_id,
        actor,
        event_type,
        meta
      )
      VALUES ($1,'RIDER','CREATED',$2)
      `,
            [
                rideId,
                JSON.stringify({
                    message: 'Ride created by rider',
                }),
            ],
        );

        const nearestDrivers = await this.findNearestDrivers(
            body.pickup_lat,
            body.pickup_lng,
            body.vehicle_type,
            5,
        );

        const driverIds = nearestDrivers.map(d => d.driverId);

        this.logger.debug(`Nearest drivers for ride ${rideId}: ${JSON.stringify(driverIds)}`);

        if (driverIds.length > 0) {
            this.startDispatch(rideId, driverIds);
        } else {
            // 🔁 Edge case: No drivers found initially
            await this.handleNoDriversAccept(rideId);
        }


        // 4️⃣ Return response
        return {
            rideId,
            status: 'SEARCHING_DRIVER',
            message: 'Searching for driver...',
        };
    }

    async findNearestDrivers(
        pickupLat: number,
        pickupLng: number,
        vehicleType: string,
        radiusKm = 5,
    ) {

        this.logger.debug(`Finding nearest drivers for location (${pickupLat}, ${pickupLng}), vehicle type: ${vehicleType}, radius: ${radiusKm}km`);

        // 1️⃣ get drivers from memory
        const activeDriversMap =
            this.driverLocationService.getActiveDrivers();
        
        //debug log active drivers
        this.logger.debug(`Active drivers in memory: ${JSON.stringify(Array.from(activeDriversMap.entries()))}`);
        if (activeDriversMap.size === 0) {
            return [];
        }
        
        const driverIds = Array.from(activeDriversMap.keys());

        // 2️⃣ fetch driver info from DB
        const result = await this.db.query(
            `
    SELECT id, vehicle_type, is_available
    FROM drivers
    WHERE id = ANY($1)
    `,
            [driverIds],
        );

        const driversFromDb = result.rows;

        this.logger.debug(`Drivers fetched from DB: ${JSON.stringify(driversFromDb)}`);

        // 3️⃣ filter by availability + vehicle type
        const eligibleDrivers = driversFromDb.filter(
            (d) =>
                d.is_available === true &&
                d.vehicle_type === vehicleType,
        );

        //debug log eligible drivers
        this.logger.debug(`Eligible drivers after DB filter: ${JSON.stringify(eligibleDrivers)}`);

        if (eligibleDrivers.length === 0) {
            return [];
        }

        // 4️⃣ calculate distance and filter by radius
        const driversWithDistance = eligibleDrivers
            .map((driver) => {
                const location = activeDriversMap.get(driver.id);

                if (!location) return null;

                const distance = this.calculateDistanceKm(
                    pickupLat,
                    pickupLng,
                    location.lat,
                    location.lng,
                );

                return {
                    driverId: driver.id,
                    distance,
                };
            })
            .filter(
                (d) => d !== null && d.distance <= radiusKm,
            );

        // 5️⃣ sort by nearest
        driversWithDistance.sort(
            (a, b) => a.distance - b.distance,
        );

        return driversWithDistance;
    }

    private calculateDistanceKm(
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number,
    ): number {
        const R = 6371; // Earth radius in km
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    async startDispatch(rideId: number, driverIds: number[]) {
        this.logger.log(`Starting dispatch for ride ${rideId} to drivers: ${JSON.stringify(driverIds)}`);
        this.dispatchDriverLists.set(rideId, driverIds);
        this.dispatchIndexes.set(rideId, 0);

        // Start sequential dispatch - one driver at a time
        await this.tryNextDriver(rideId);
    }

    private async tryNextDriver(rideId: number) {
        const driverList = this.dispatchDriverLists.get(rideId);
        let index = this.dispatchIndexes.get(rideId);

        if (!driverList || index === undefined) {
            // No more drivers, handle failure
            await this.handleNoDriversAccept(rideId);
            this.stopDispatch(rideId);
            return;
        }

        if (index >= driverList.length) {
            this.logger.log(`No more drivers available for ride ${rideId}`);
            await this.handleNoDriversAccept(rideId);
            this.stopDispatch(rideId);
            return;
        }

        const driverId = driverList[index];

        // Check if ride is still searching (might have been accepted or cancelled)
        const rideCheck = await this.db.query(
            `SELECT status FROM rides WHERE id = $1`,
            [rideId],
        );

        if (!rideCheck.rows.length || rideCheck.rows[0].status !== 'SEARCHING_DRIVER') {
            // Ride already assigned, cancelled, or in another state
            this.stopDispatch(rideId);
            return;
        }

        // 🔁 Edge case: Check if driver is still online
        const isDriverOffline = await this.checkDriverOffline(rideId, driverId);
        if (isDriverOffline) {
            this.logger.debug(`Skipping offline driver ${driverId} for ride ${rideId}`);
            // Skip this driver and move to next
            this.dispatchIndexes.set(rideId, index + 1);
            return this.tryNextDriver(rideId);
        }

        // Check pending request flag
        const result = await this.db.query(
            `SELECT has_pending_request FROM drivers WHERE id = $1`,
            [driverId],
        );

        if (!result.rows.length || result.rows[0].has_pending_request) {
            // skip driver and try next
            this.dispatchIndexes.set(rideId, index + 1);
            return this.tryNextDriver(rideId);
        }

        // Insert dispatch record
        await this.db.query(
            `
    INSERT INTO ride_driver_dispatch (
      ride_id,
      driver_id,
      attempt_order,
      status
    )
    VALUES ($1,$2,$3,'REQUESTED')
    `,
            [rideId, driverId, index + 1],
        );

        // Mark pending
        await this.db.query(
            `UPDATE drivers SET has_pending_request = true WHERE id = $1`,
            [driverId],
        );

        // Notify driver
        this.notificationsService.notifyDriver(driverId, 'NEW_RIDE_REQUEST', {
            rideId,
        });

        this.logger.log(`Ride ${rideId} requested to driver ${driverId} (sequential)`);

        // Start timeout - wait for this driver's response before trying next
        const timer = setTimeout(async () => {
            await this.handleDriverTimeout(rideId, driverId);
        }, DISPATCH_CONFIG.responseTimeoutSec * 1000);

        this.dispatchTimers.set(rideId, timer);
    }

    private async handleDriverTimeout(
        rideId: number,
        driverId: number,
    ) {
        // Check if ride is still searching
        const rideCheck = await this.db.query(
            `SELECT status FROM rides WHERE id = $1`,
            [rideId],
        );

        if (!rideCheck.rows.length || rideCheck.rows[0].status !== 'SEARCHING_DRIVER') {
            // Ride already assigned, just cleanup
            this.stopDispatch(rideId);
            return;
        }

        this.logger.log(`Driver ${driverId} timeout for ride ${rideId}`);

        // 🔁 Edge case: Check if driver went offline
        const isDriverOffline = await this.checkDriverOffline(rideId, driverId);
        if (isDriverOffline) {
            this.logger.debug(`Driver ${driverId} went offline during dispatch for ride ${rideId}`);
        }

        // update dispatch row
        await this.db.query(
            `
    UPDATE ride_driver_dispatch
    SET status = 'TIMEOUT',
        responded_at = NOW()
    WHERE ride_id = $1
    AND driver_id = $2
    AND status = 'REQUESTED'
    `,
            [rideId, driverId],
        );

        // clear pending flag
        await this.db.query(
            `UPDATE drivers SET has_pending_request = false WHERE id = $1`,
            [driverId],
        );

        // move to next driver sequentially
        const index = this.dispatchIndexes.get(rideId) || 0;
        this.dispatchIndexes.set(rideId, index + 1);

        // Clear timer for this ride
        const timer = this.dispatchTimers.get(rideId);
        if (timer) {
            clearTimeout(timer);
            this.dispatchTimers.delete(rideId);
        }

        // 🔁 Edge case: Check if we have more drivers
        const driverList = this.dispatchDriverLists.get(rideId);
        const nextIndex = this.dispatchIndexes.get(rideId) || 0;

        if (!driverList || nextIndex >= driverList.length) {
            // No more drivers available
            this.logger.log(`No more drivers available for ride ${rideId}`);
            await this.handleNoDriversAccept(rideId);
            this.stopDispatch(rideId);
            return;
        }

        // Try next driver
        await this.tryNextDriver(rideId);
    }

    private stopDispatch(rideId: number) {
        const timer = this.dispatchTimers.get(rideId);

        if (timer) {
            clearTimeout(timer);
            this.dispatchTimers.delete(rideId);
        }

        this.dispatchDriverLists.delete(rideId);
        this.dispatchIndexes.delete(rideId);

        this.logger.log(`Dispatch stopped for ride ${rideId}`);
    }

    async handleDriverAccept(driverId: number, rideId: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 🔁 Edge case: Check if driver is still online
            const isDriverOffline = await this.checkDriverOffline(rideId, driverId);
            if (isDriverOffline) {
                throw new BadRequestException('Driver is offline and cannot accept rides');
            }

            // 1️⃣ Check ride status
            const rideRes = await client.query(
                `SELECT status, rider_id FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            // 🔁 Edge case: Check if ride was cancelled during dispatch
            if (ride.status === 'CANCELLED') {
                throw new BadRequestException('Ride has been cancelled');
            }

            if (ride.status !== 'SEARCHING_DRIVER') {
                throw new BadRequestException('Ride no longer available');
            }

            // 2️⃣ Check dispatch row
            const dispatchRes = await client.query(
                `
      SELECT id FROM ride_driver_dispatch
      WHERE ride_id = $1
      AND driver_id = $2
      AND status = 'REQUESTED'
      ORDER BY attempt_order DESC
      LIMIT 1
      FOR UPDATE
      `,
                [rideId, driverId],
            );

            if (!dispatchRes.rows.length) {
                // 🔁 Edge case: Driver accepts but dispatch row doesn't exist (network failure recovery)
                // This could happen if the driver accepted but network failed before dispatch was updated
                // Check if there's any dispatch row for this driver
                const anyDispatch = await client.query(
                    `SELECT id, status FROM ride_driver_dispatch 
                     WHERE ride_id = $1 AND driver_id = $2 
                     ORDER BY attempt_order DESC LIMIT 1`,
                    [rideId, driverId],
                );

                if (anyDispatch.rows.length && anyDispatch.rows[0].status === 'ACCEPTED') {
                    // Already accepted, return success
                    await client.query('COMMIT');
                    return { success: true, message: 'Ride already accepted' };
                }

                throw new BadRequestException('No valid dispatch found. The ride request may have expired.');
            }

            // 3️⃣ Update dispatch row
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

            // 4️⃣ Update ride
            await client.query(
                `
      UPDATE rides
      SET driver_id = $1,
          status = 'DRIVER_ASSIGNED'
      WHERE id = $2
      `,
                [driverId, rideId],
            );

            // 5️⃣ Update driver flags
            await client.query(
                `
      UPDATE drivers
      SET has_pending_request = false,
          is_available = false
      WHERE id = $1
      `,
                [driverId],
            );

            // 6️⃣ Insert ride event
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

            // 7️⃣ Stop dispatch loop (sequential - only one driver at a time, so no need to cancel others)
            this.stopDispatch(rideId);

            // 8️⃣ Generate OTP (4-digit code)
            const otp = this.generateOtp();
            const { expiresIn } = this.storeOtp(rideId, otp, ride.rider_id, driverId);

            // 9️⃣ Send OTP to rider via WebSocket
            this.socketGateway.sendToRider(ride.rider_id, 'RIDE_ACCEPTED_WITH_OTP', {
                rideId,
                driverId,
                otp,
                expiresIn,
            });

            // 🔟 Notify rider via notifications service
            this.notificationsService.notifyRider(ride.rider_id, 'RIDE_ASSIGNED', {
                rideId,
                driverId,
            });

            // 1️⃣1️⃣ Behaviour hook
            this.driverBehaviorService.recordDriverAccepted(driverId, rideId);

            this.logger.log(`Driver ${driverId} assigned to ride ${rideId}, OTP generated`);

            return { success: true, message: 'Ride accepted, OTP sent to rider' };

        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error(err.message);
            throw err;
        } finally {
            client.release();
        }
    }

    // 🚘 Phase 6 — Driver moving to pickup
    async markDriverArrived(driverId: number, rideId: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 1️⃣ Check ride status and driver
            const rideRes = await client.query(
                `SELECT status, rider_id, driver_id FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            if (ride.driver_id !== driverId) {
                throw new BadRequestException('You are not assigned to this ride');
            }

            if (ride.status !== 'DRIVER_ASSIGNED') {
                throw new BadRequestException(`Ride is in ${ride.status} status, cannot mark as arrived`);
            }

            // 2️⃣ Update ride status
            await client.query(
                `UPDATE rides SET status = 'DRIVER_ARRIVING' WHERE id = $1`,
                [rideId],
            );

            // 3️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'DRIVER', 'DRIVER_ARRIVED', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        driverId,
                        arrivedAt: new Date().toISOString(),
                    }),
                ],
            );

            await client.query('COMMIT');

            // 4️⃣ Notify rider
            this.notificationsService.notifyRider(ride.rider_id, 'DRIVER_ARRIVED', {
                rideId,
                driverId,
            });

            return { success: true, message: 'Driver arrived notification sent' };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // 🧍 Phase 7 — Trip starts
    async startTrip(driverId: number, rideId: number, otpCode?: string) {
        const client = await this.db.getClient();

        try {
            // 0️⃣ Validate OTP if provided
            if (otpCode) {
                const otpValidation = this.validateOtp(rideId, otpCode);
                if (!otpValidation.valid) {
                    throw new BadRequestException(otpValidation.error);
                }
            }

            await client.query('BEGIN');

            // 1️⃣ Check ride status and driver
            const rideRes = await client.query(
                `SELECT status, rider_id, driver_id FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            if (ride.driver_id !== driverId) {
                throw new BadRequestException('You are not assigned to this ride');
            }

            if (ride.status !== 'DRIVER_ARRIVING') {
                throw new BadRequestException(`Ride is in ${ride.status} status, cannot start trip`);
            }

            // 2️⃣ Update ride status
            await client.query(
                `UPDATE rides SET status = 'ON_TRIP' WHERE id = $1`,
                [rideId],
            );

            // 3️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'DRIVER', 'TRIP_STARTED', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        driverId,
                        startedAt: new Date().toISOString(),
                    }),
                ],
            );

            await client.query('COMMIT');

            // 4️⃣ Clear OTP from memory after successful trip start
            this.clearOtp(rideId);

            // 5️⃣ Notify rider
            this.notificationsService.notifyRider(ride.rider_id, 'TRIP_STARTED', {
                rideId,
                driverId,
            });

            return { success: true, message: 'Trip started' };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // 🏁 Phase 8 — Trip completes
    async completeTrip(driverId: number, rideId: number, finalFare?: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 1️⃣ Check ride status and driver
            const rideRes = await client.query(
                `SELECT status, rider_id, driver_id, estimated_fare FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            if (ride.driver_id !== driverId) {
                throw new BadRequestException('You are not assigned to this ride');
            }

            if (ride.status !== 'ON_TRIP') {
                throw new BadRequestException(`Ride is in ${ride.status} status, cannot complete trip`);
            }

            // 2️⃣ Use provided final_fare or estimated_fare
            const fare = finalFare || ride.estimated_fare;

            // 3️⃣ Update ride status and final fare
            await client.query(
                `UPDATE rides SET status = 'COMPLETED', final_fare = $1 WHERE id = $2`,
                [fare, rideId],
            );

            // 4️⃣ Update driver to available
            await client.query(
                `UPDATE drivers SET is_available = true WHERE id = $1`,
                [driverId],
            );

            // 5️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'DRIVER', 'TRIP_COMPLETED', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        driverId,
                        completedAt: new Date().toISOString(),
                        finalFare: fare,
                    }),
                ],
            );

            await client.query('COMMIT');

            // 6️⃣ Clear OTP from memory
            this.clearOtp(rideId);

            // 7️⃣ Notify rider
            this.notificationsService.notifyRider(ride.rider_id, 'TRIP_COMPLETED', {
                rideId,
                driverId,
                finalFare: fare,
            });

            return { success: true, message: 'Trip completed', finalFare: fare };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ❌ Phase 9 — Cancellation logic
    async cancelRideByRider(riderId: number, rideId: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 1️⃣ Check ride status and rider
            const rideRes = await client.query(
                `SELECT status, rider_id, driver_id, estimated_fare FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            if (ride.rider_id !== riderId) {
                throw new BadRequestException('You are not authorized to cancel this ride');
            }

            if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
                throw new BadRequestException('Ride is already completed or cancelled');
            }

            // 2️⃣ Calculate cancellation fee based on ride stage
            let cancellationFee = 0;
            let cancellationReason = '';

            if (ride.status === 'SEARCHING_DRIVER') {
                // Before driver assigned → no fee
                cancellationFee = 0;
                cancellationReason = 'Cancelled before driver assignment';
            } else if (ride.status === 'DRIVER_ASSIGNED') {
                // After assigned but before arrived → small fee (e.g., 10% of estimated fare)
                cancellationFee = Math.round(ride.estimated_fare * 0.1);
                cancellationReason = 'Cancelled after driver assignment';
            } else if (ride.status === 'DRIVER_ARRIVING') {
                // After driver arrived → cancellation fee (e.g., 25% of estimated fare)
                cancellationFee = Math.round(ride.estimated_fare * 0.25);
                cancellationReason = 'Cancelled after driver arrived';
            } else if (ride.status === 'ON_TRIP') {
                // During trip → full fare
                cancellationFee = ride.estimated_fare;
                cancellationReason = 'Cancelled during trip';
            }

            // 3️⃣ Update ride status
            await client.query(
                `UPDATE rides 
                SET status = 'CANCELLED', 
                    cancelled_by = 'RIDER',
                    cancellation_fee = $1
                WHERE id = $2`,
                [cancellationFee, rideId],
            );

            // 4️⃣ If driver was assigned, make them available again
            if (ride.driver_id) {
                await client.query(
                    `UPDATE drivers SET is_available = true, has_pending_request = false WHERE id = $1`,
                    [ride.driver_id],
                );

                // Notify driver
                this.notificationsService.notifyDriver(ride.driver_id, 'RIDE_CANCELLED', {
                    rideId,
                    cancelledBy: 'RIDER',
                });
            }

            // 5️⃣ Stop dispatch if still running
            this.stopDispatch(rideId);

            // 6️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'RIDER', 'RIDE_CANCELLED', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        riderId,
                        cancelledAt: new Date().toISOString(),
                        cancellationFee,
                        reason: cancellationReason,
                    }),
                ],
            );

            await client.query('COMMIT');

            // 7️⃣ Clear OTP from memory
            this.clearOtp(rideId);

            return {
                success: true,
                message: 'Ride cancelled',
                cancellationFee,
                reason: cancellationReason,
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async cancelRideByDriver(driverId: number, rideId: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 1️⃣ Check ride status and driver
            const rideRes = await client.query(
                `SELECT status, rider_id, driver_id, estimated_fare FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                throw new BadRequestException('Ride not found');
            }

            const ride = rideRes.rows[0];

            if (ride.driver_id !== driverId) {
                throw new BadRequestException('You are not assigned to this ride');
            }

            if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
                throw new BadRequestException('Ride is already completed or cancelled');
            }

            // 2️⃣ Calculate penalty based on ride stage
            let penalty = 0;
            let cancellationReason = '';

            if (ride.status === 'DRIVER_ASSIGNED') {
                // Before arriving → small penalty
                penalty = Math.round(ride.estimated_fare * 0.1);
                cancellationReason = 'Cancelled before arriving at pickup';
            } else if (ride.status === 'DRIVER_ARRIVING') {
                // After arriving → medium penalty
                penalty = Math.round(ride.estimated_fare * 0.25);
                cancellationReason = 'Cancelled after arriving at pickup';
            } else if (ride.status === 'ON_TRIP') {
                // During trip → significant penalty
                penalty = Math.round(ride.estimated_fare * 0.5);
                cancellationReason = 'Cancelled during active trip';
            }

            // 3️⃣ Update ride status
            await client.query(
                `UPDATE rides 
                SET status = 'CANCELLED', 
                    cancelled_by = 'DRIVER',
                    cancellation_fee = $1
                WHERE id = $2`,
                [penalty, rideId],
            );

            // 4️⃣ Make driver available again
            await client.query(
                `UPDATE drivers SET is_available = true, has_pending_request = false WHERE id = $1`,
                [driverId],
            );

            // 5️⃣ Stop dispatch if still running
            this.stopDispatch(rideId);

            // 6️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'DRIVER', 'RIDE_CANCELLED', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        driverId,
                        cancelledAt: new Date().toISOString(),
                        penalty,
                        reason: cancellationReason,
                    }),
                ],
            );

            await client.query('COMMIT');

            // 8️⃣ Clear OTP from memory
            this.clearOtp(rideId);

            // 9️⃣ Notify rider
            this.notificationsService.notifyRider(ride.rider_id, 'RIDE_CANCELLED', {
                rideId,
                cancelledBy: 'DRIVER',
                penalty,
            });

            return {
                success: true,
                message: 'Ride cancelled by driver',
                penalty,
                reason: cancellationReason,
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // 🔁 Phase 10 — Edge case handling
    async handleNoDriversAccept(rideId: number) {
        const client = await this.db.getClient();

        try {
            await client.query('BEGIN');

            // 1️⃣ Check if ride is still searching
            const rideRes = await client.query(
                `SELECT status, rider_id FROM rides WHERE id = $1 FOR UPDATE`,
                [rideId],
            );

            if (!rideRes.rows.length) {
                return; // Ride doesn't exist
            }

            const ride = rideRes.rows[0];

            if (ride.status !== 'SEARCHING_DRIVER') {
                return; // Ride already assigned or cancelled
            }

            // 2️⃣ Update ride status to indicate failure
            await client.query(
                `UPDATE rides SET status = 'CANCELLED', cancelled_by = 'SYSTEM' WHERE id = $1`,
                [rideId],
            );

            // 3️⃣ Insert event
            await client.query(
                `INSERT INTO ride_events (ride_id, actor, event_type, meta)
                VALUES ($1, 'SYSTEM', 'RIDE_FAILED_NO_DRIVERS', $2)`,
                [
                    rideId,
                    JSON.stringify({
                        failedAt: new Date().toISOString(),
                        reason: 'No drivers available to accept the ride',
                    }),
                ],
            );

            await client.query('COMMIT');

            // 4️⃣ Notify rider
            this.notificationsService.notifyRider(ride.rider_id, 'RIDE_FAILED', {
                rideId,
                reason: 'No drivers available',
            });

            // 5️⃣ Cleanup dispatch
            this.stopDispatch(rideId);

            return { success: true, message: 'Ride failed - no drivers available' };
        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error('Error handling no drivers accept:', err as any);
            throw err;
        } finally {
            client.release();
        }
    }

    // Helper method to check if driver went offline during dispatch
    private async checkDriverOffline(rideId: number, driverId: number): Promise<boolean> {
        const activeDrivers = this.driverLocationService.getActiveDrivers();
        return !activeDrivers.has(driverId);
    }


    async getRideDetails(userId: number, rideId: number) {
        const result = await this.db.query(
            `
    SELECT *
    FROM rides
    WHERE id = $1
    AND rider_id = $2
    `,
            [rideId, userId],
        );

        if (result.rowCount === 0) {
            throw new BadRequestException('Ride not found');
        }

        return result.rows[0];
    }

}
