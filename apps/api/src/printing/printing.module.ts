import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';

@Module({
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
