import { Module, forwardRef } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { SuppliersModule } from '../suppliers/suppliers.module';

@Module({
  imports: [forwardRef(() => SuppliersModule)],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
