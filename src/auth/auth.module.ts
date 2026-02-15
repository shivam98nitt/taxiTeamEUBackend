import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow('JWT_ACCESS_EXPIRES'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard,WsJwtAuthGuard],
  exports: [AuthService, JwtAuthGuard,WsJwtAuthGuard, JwtModule],
})
export class AuthModule {}
