import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { LabourRevenueController } from './labour-revenue.controller';
import { LabourRevenueService } from './labour-revenue.service';

@Module({
  imports: [PaymentsModule],
  controllers: [LabourRevenueController],
  providers: [LabourRevenueService],
  exports: [LabourRevenueService],
})
export class LabourRevenueModule {}
