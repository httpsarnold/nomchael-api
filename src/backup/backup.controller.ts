import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles.decorator';
import { BackupService } from './backup.service';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.MANAGING_DIRECTOR)
export class BackupController {
  constructor(private backup: BackupService) {}

  @Get('preview')
  preview() {
    return this.backup.preview();
  }

  @Get('database')
  async downloadDatabase(
    @Req() req: Request & { user?: { id?: string } },
    @Res() res: Response,
  ) {
    const { filename, buffer } = await this.backup.buildBackup(req.user?.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}
