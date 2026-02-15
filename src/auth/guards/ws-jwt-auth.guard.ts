import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    // Option 1: token from handshake.auth
    let token = client.handshake.auth?.token;

    // Option 2: token from headers (fallback)
    if (!token) {
      const authHeader = client.handshake.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
      }
    }

    if (!token) {
      throw new UnauthorizedException('Missing socket auth token');
    }

    try {
      const payload = this.jwtService.verify(token);

      // Attach user info to socket
      client.data.user = {
        userId: payload.sub,
        role: payload.role,
      };

      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired socket token');
    }
  }
}
