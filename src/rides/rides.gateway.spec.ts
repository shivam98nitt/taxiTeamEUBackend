import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { Socket } from 'socket.io';
import { RidesGateway } from './rides.gateway';

describe('RidesGateway', () => {
  it('authenticates a driver, marks them online, and targets ride requests', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 42 }) };
    const gateway = new RidesGateway(
      jwt as unknown as JwtService,
      db as unknown as DatabaseService,
    );
    const socket = {
      handshake: { auth: { token: 'valid-token', clientType: 'driver' } },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(socket as unknown as Socket);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE drivers'),
      [42],
    );
    expect(socket.join).toHaveBeenCalledWith('driver:42');
    expect(socket.disconnect).not.toHaveBeenCalled();

    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    const ride = { id: 11, pickup_lat: 1 };

    gateway.notifyDriver(42, ride);

    expect(to).toHaveBeenCalledWith('driver:42');
    expect(emit).toHaveBeenCalledWith('NEW_RIDE_REQUEST', ride);
  });

  it('keeps rider sockets out of driver rooms', async () => {
    const db = { query: jest.fn() };
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 17 }) };
    const gateway = new RidesGateway(
      jwt as unknown as JwtService,
      db as unknown as DatabaseService,
    );
    const socket = {
      handshake: { auth: { token: 'valid-token', clientType: 'rider' } },
      data: {},
      join: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(socket as unknown as Socket);

    expect(socket.join).toHaveBeenCalledWith('rider:17');
    expect(db.query).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
