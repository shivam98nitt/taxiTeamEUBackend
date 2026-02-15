import { Module } from '@nestjs/common';
import {ThrottlerModule,seconds} from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { MapsModule } from './maps/maps.module';
import { RideModule } from './ride/ride.module';
import { DriversModule } from './drivers/drivers.module';
import { SocketModule } from './socket/socket.module';
import { DriverLocationModule } from './driver-location/driver-location.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers:[{
        ttl: seconds(60),
        limit: 30,
      }]
    }),
    SocketModule,
    AuthModule,
    UsersModule,
    DatabaseModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MapsModule,
    RideModule,
    DriversModule,
    DriverLocationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
