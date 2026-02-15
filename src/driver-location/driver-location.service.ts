// src/driver-location/driver-location.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

type DriverLocation = {
    lat: number;
    lng: number;
    lastSeen: number;
};

@Injectable()
export class DriverLocationService implements OnModuleInit {
    private drivers = new Map<number, DriverLocation>();
    private readonly logger = new Logger(DriverLocationService.name);

    constructor(private readonly db: DatabaseService) { }

    onModuleInit() {
        setInterval(() => this.cleanupStaleDrivers(), 5000);   // TTL check
        setInterval(() => this.snapshotToDB(), 45000);         // DB snapshot
    }

    async updateLocation(driverId: number, lat: number, lng: number) {
        const isNew = !this.drivers.has(driverId);

        this.drivers.set(driverId, {
            lat,
            lng,
            lastSeen: Date.now(),
        });

        if (isNew) {
            this.logger.log(`🟢 Driver ${driverId} came online`);
            await this.markDriverOnline(driverId);
        }
    }


    async removeDriver(driverId: number) {
        if (this.drivers.has(driverId)) {
            this.drivers.delete(driverId);
            this.logger.log(`🔴 Driver ${driverId} removed (socket disconnect)`);

            await this.markDriverOffline(driverId);
        }
    }


    getActiveDrivers() {
        return this.drivers;
    }

    private async cleanupStaleDrivers() {
        const now = Date.now();

        for (const [driverId, data] of this.drivers.entries()) {
            if (now - data.lastSeen > 12000) {
                this.drivers.delete(driverId);
                this.logger.log(`⏳ Driver ${driverId} removed (TTL exceeded)`);

                await this.markDriverOffline(driverId);
            }
        }
    }


    private async snapshotToDB() {

        if (this.drivers.size === 0) {
            return; // nothing to do
        }

        this.logger.debug(`📸 Snapshot running... Active: ${this.drivers.size}`);

        for (const [driverId, data] of this.drivers.entries()) {
            await this.db.query(
                `
        UPDATE drivers
        SET current_lat = $1,
            current_lng = $2,
            location_updated_at = NOW()
        WHERE id = $3
        `,
                [data.lat, data.lng, driverId],
            );
            this.logger.debug(`✅ DB updated for driver ${driverId}`);
        }
    }

    private async markDriverOnline(driverId: number) {
        await this.db.query(
            `
    UPDATE drivers
    SET is_online = true,
        is_available = true,
        updated_at = NOW()
    WHERE id = $1
    `,
            [driverId],
        );
    }

    private async markDriverOffline(driverId: number) {
        await this.db.query(
            `
    UPDATE drivers
    SET is_online = false,
        is_available = false,
        updated_at = NOW()
    WHERE id = $1
    `,
            [driverId],
        );
    }

}
