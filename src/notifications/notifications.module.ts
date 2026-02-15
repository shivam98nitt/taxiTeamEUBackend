import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SocketModule } from 'src/socket/socket.module';

@Module({
  imports: [SocketModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}