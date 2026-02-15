import { Test, TestingModule } from '@nestjs/testing';
import { DriverLocationController } from './driver-location.controller';

describe('DriverLocationController', () => {
  let controller: DriverLocationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DriverLocationController],
    }).compile();

    controller = module.get<DriverLocationController>(DriverLocationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
