import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { AuthModule } from 'src/auth/auth.module';
import { DriverLocationModule } from 'src/driver-location/driver-location.module';

@Module({
  providers: [SocketGateway],
  imports: [AuthModule, DriverLocationModule],
  exports: [SocketGateway],
})
export class SocketModule {}
