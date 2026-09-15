import { Module } from '@nestjs/common';
import { StandPackagesController } from './stand-packages.controller';
import { StandPackagesService } from './stand-packages.service';

@Module({
  controllers: [StandPackagesController],
  providers: [StandPackagesService],
  exports: [StandPackagesService],
})
export class StandPackagesModule {}
