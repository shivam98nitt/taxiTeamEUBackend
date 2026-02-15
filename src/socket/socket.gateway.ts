import { UseGuards, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtAuthGuard } from 'src/auth/guards/ws-jwt-auth.guard';
import { DriverLocationService } from 'src/driver-location/driver-location.service';

@UseGuards(WsJwtAuthGuard)
@WebSocketGateway({
    cors: {
        origin: ['http://localhost:4937', 'http://localhost:3000'],
        credentials: true,
    },
})

export class SocketGateway
    implements OnGatewayConnection, OnGatewayDisconnect {

    private readonly logger = new Logger(SocketGateway.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly driverLocationService: DriverLocationService,
    ) { }

    // userId -> socketId
    private riderSockets = new Map<number, string>();
    private driverSockets = new Map<number, string>();


    @WebSocketServer()
    server: Server;
 
    handleConnection(client: Socket) {
        const token = client.handshake.auth?.token;
        if (!token) {
            client.disconnect();
            this.logger.warn('Socket disconnected: No token provided');
            return;
        }

        try {
            // verify JWT (reuse your auth service)
            const payload = this.jwtService.verify(token);
            client.data.user = {
                userId: payload.sub,
                role: payload.role,
            };


            const { userId, role } = client.data.user;

            if (role === 'DRIVER') {
                this.driverSockets.set(userId, client.id);
                // print all driver sockets for debugging
                this.logger.debug(`Current driver sockets: ${JSON.stringify(Array.from(this.driverSockets.entries()))}`);
            }

            if (role === 'RIDER') {
                this.riderSockets.set(userId, client.id);
                // print all rider sockets for debugging
                this.logger.debug(`Current rider sockets: ${JSON.stringify(Array.from(this.riderSockets.entries()))}`);
            }

            this.logger.log(`Socket connection id: ${client.id}`);
            this.logger.log(`Socket connected user=${payload.sub} role=${payload.role}`);
        } catch (err) {
            this.logger.warn('Socket disconnected: Invalid token ' + err.message);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const user = client.data.user;

        if (!user) return;

        const { userId, role } = user;

        if (role === 'DRIVER') {
            this.driverSockets.delete(userId);
        }

        if (role === 'RIDER') {
            this.riderSockets.delete(userId);
        }

        this.driverLocationService.removeDriver(userId);

        this.logger.log(`Socket disconnected userId=${userId} role=${role}`);
    }

    @SubscribeMessage('DRIVER_LOCATION_UPDATE')
    handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { lat: number; lng: number }
    ) {
        const user = client.data.user;

        // if (!user || user.role !== 'DRIVER') return;
        this.logger.debug(`Location update from driver: ${user.userId} ${JSON.stringify(body)}`);
        this.driverLocationService.updateLocation(
            user.userId,
            body.lat,
            body.lng,
        );
    }

    @SubscribeMessage('DRIVER_ACCEPT_RIDE')
    async handleDriverAccept(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { rideId: number },
    ) {
        const user = client.data.user;

        if (!user || user.role !== 'DRIVER') {
            client.emit('ERROR', { message: 'Unauthorized' });
            return;
        }

        // Notify client to use HTTP endpoint for accepting rides
        // This keeps WebSocket for real-time notifications only
        client.emit('DRIVER_ACCEPT_RIDE_INFO', {
            rideId: body.rideId,
            message: 'Use POST /ride/accept endpoint to accept the ride',
            endpoint: '/ride/accept',
        });
    }



    sendToDriver(driverId: number, event: string, payload: any) {
        const socketId = this.driverSockets.get(driverId);

        if (!socketId) {
            this.logger.debug(`Driver not connected: ${driverId}`);
            return;
        }

        this.server.to(socketId).emit(event, payload);
    }

    sendToRider(riderId: number, event: string, payload: any) {
        const socketId = this.riderSockets.get(riderId);

        if (!socketId) {
            this.logger.debug(`Rider not connected: ${riderId}`);
            return;
        }

        this.server.to(socketId).emit(event, payload);
    }

}



