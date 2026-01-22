import { Module } from '@nestjs/common';
import {ThrottlerModule,seconds} from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { MapsModule } from './maps/maps.module';
import { RidesModule } from './rides/rides.module';
import { DriversModule } from './drivers/drivers.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers:[{
        ttl: seconds(60),
        limit: 30,
      }]
    }),
    AuthModule,
    UsersModule,
    DatabaseModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MapsModule,
    RidesModule,
    DriversModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
