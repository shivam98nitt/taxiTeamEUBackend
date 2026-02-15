import { Injectable } from '@nestjs/common';
import { SocketGateway } from 'src/socket/socket.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly socketGateway: SocketGateway,
  ) {}

  notifyDriver(driverId: number, event: string, payload: any) {
    this.socketGateway.sendToDriver(driverId, event, payload);
  }

  notifyRider(riderId: number, event: string, payload: any) {
    this.socketGateway.sendToRider(riderId, event, payload);
  }
}
