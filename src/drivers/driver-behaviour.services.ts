import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DriverBehaviorService {
  private readonly logger = new Logger(DriverBehaviorService.name);

  recordDriverAccepted(driverId: number, rideId: number) {
    // Placeholder for future logic:
    // scoring, ranking, incentives, penalties, etc.
    this.logger.log(`Driver ${driverId} accepted ride ${rideId}`);
  }

  recordDriverIgnored(driverId: number, rideId: number) {
    // Future punishment logic can go here
    this.logger.log(`Driver ${driverId} ignored ride ${rideId}`);
  }
}
