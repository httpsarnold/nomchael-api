import { Module } from '@nestjs/common';
import { StageTemplatesController } from './stage-templates.controller';

@Module({ controllers: [StageTemplatesController] })
export class StageTemplatesModule {}
