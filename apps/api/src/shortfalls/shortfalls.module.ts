import { Module } from '@nestjs/common';
import { ShortfallsController } from './shortfalls.controller';
import { ShortfallsService } from './shortfalls.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [ShortfallsController],
  providers: [ShortfallsService],
})
export class ShortfallsModule {}
