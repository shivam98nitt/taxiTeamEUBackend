import { Test, TestingModule } from '@nestjs/testing';
import { RidesService } from './rides.service';
import { DatabaseService } from '../database/database.service';
import { RidesGateway } from './rides.gateway';

describe('RidesService', () => {
  let service: RidesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesService,
        { provide: DatabaseService, useValue: {} },
        { provide: RidesGateway, useValue: {} },
      ],
    }).compile();

    service = module.get<RidesService>(RidesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
