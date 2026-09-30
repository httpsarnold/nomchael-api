import { Module } from '@nestjs/common';
import { QuickQuotationsController } from './quick-quotations.controller';
import { QuickQuotationsService } from './quick-quotations.service';

@Module({
  controllers: [QuickQuotationsController],
  providers: [QuickQuotationsService],
})
export class QuickQuotationsModule {}
