import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { StockModule } from '../stock/stock.module';
import { SiteVisitsModule } from '../site-visits/site-visits.module';

@Module({
  imports: [WhatsappModule, StockModule, SiteVisitsModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
