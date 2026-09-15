import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrintingModule } from '../printing/printing.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrintingModule, StockModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
