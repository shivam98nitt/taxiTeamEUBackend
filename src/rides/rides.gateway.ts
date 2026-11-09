import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { DatabaseService } from '../database/database.service';

@WebSocketGateway({ cors: { origin: true }, transports: ['websocket'] })
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RidesGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly db: DatabaseService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || token.length === 0) {
        throw new UnauthorizedException('Missing socket token');
      }

      const payload = this.jwtService.verify<{ sub: number }>(token);
      const driverId = Number(payload.sub);
      if (!Number.isInteger(driverId) || driverId <= 0) {
        throw new UnauthorizedException('Invalid driver identity');
      }

      const clientType = client.handshake.auth?.clientType;
      if (clientType === 'rider') {
        client.data.riderId = driverId;
        await client.join(`rider:${driverId}`);
        return;
      }
      if (clientType !== 'driver') {
        throw new UnauthorizedException('Invalid socket client type');
      }

      client.data.driverId = driverId;
      await client.join(this.driverRoom(driverId));

      const result = await this.db.query(
        `UPDATE drivers
         SET is_online = true, is_available = true
         WHERE id = $1`,
        [driverId],
      );
      if (!result.rowCount) {
        throw new UnauthorizedException('Driver profile not found');
      }

      this.logger.log(`Driver ${driverId} connected`);
    } catch (error) {
      this.logger.warn(
        `Rejected socket connection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const driverId = client.data.driverId as number | undefined;
    if (driverId === undefined) return;

    try {
      await this.db.query(
        `UPDATE drivers
         SET is_online = false,
             is_available = false,
             has_pending_request = false,
             pending_ride_id = NULL
         WHERE id = $1`,
        [driverId],
      );
      this.logger.log(`Driver ${driverId} disconnected`);
    } catch (error) {
      this.logger.error(
        `Failed to mark driver ${driverId} offline: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @SubscribeMessage('DRIVER_LOCATION_UPDATE')
  async updateDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat?: number; lng?: number },
  ) {
    const driverId = client.data.driverId as number | undefined;
    if (
      driverId === undefined ||
      typeof data?.lat !== 'number' ||
      typeof data?.lng !== 'number' ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lng)
    ) {
      return;
    }

    await this.db.query(
      `UPDATE drivers
       SET current_lat = $1, current_lng = $2
       WHERE id = $3 AND is_online = true`,
      [data.lat, data.lng, driverId],
    );
  }

  notifyDriver(driverId: number, ride: Record<string, unknown>) {
    this.server.to(this.driverRoom(driverId)).emit('NEW_RIDE_REQUEST', ride);
  }

  private driverRoom(driverId: number) {
    return `driver:${driverId}`;
  }
}
