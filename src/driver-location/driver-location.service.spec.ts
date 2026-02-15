import { Test, TestingModule } from '@nestjs/testing';
import { DriverLocationService } from './driver-location.service';

describe('DriverLocationService', () => {
  let service: DriverLocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DriverLocationService],
    }).compile();

    service = module.get<DriverLocationService>(DriverLocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
