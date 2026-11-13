import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BackupTableSummary = {
  table: string;
  rowCount: number;
};

export type BackupPayload = {
  format: 'nomchael-json-v1';
  createdAt: string;
  database: string;
  tables: Record<string, unknown[]>;
  summary: BackupTableSummary[];
};

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService) {}

  async listPublicTables(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    );
    return rows.map((r) => r.table_name);
  }

  async preview(): Promise<{
    createdAt: string;
    tableCount: number;
    totalRows: number;
    tables: BackupTableSummary[];
  }> {
    const tables = await this.listPublicTables();
    const summary: BackupTableSummary[] = [];
    let totalRows = 0;

    for (const table of tables) {
      const [{ count }] = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
      );
      const rowCount = Number(count);
      totalRows += rowCount;
      summary.push({ table, rowCount });
    }

    return {
      createdAt: new Date().toISOString(),
      tableCount: tables.length,
      totalRows,
      tables: summary,
    };
  }

  async buildBackup(userId?: string): Promise<{ filename: string; buffer: Buffer; summary: BackupTableSummary[] }> {
    const tables = await this.listPublicTables();
    const data: Record<string, unknown[]> = {};
    const summary: BackupTableSummary[] = [];

    for (const table of tables) {
      const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "${table}"`,
      );
      data[table] = rows.map((row) => this.normalizeRow(row));
      summary.push({ table, rowCount: rows.length });
    }

    let database = 'postgres';
    try {
      const [{ db }] = await this.prisma.$queryRawUnsafe<{ db: string }[]>(
        `SELECT current_database() AS db`,
      );
      database = db;
    } catch {
      /* ignore */
    }

    const payload: BackupPayload = {
      format: 'nomchael-json-v1',
      createdAt: new Date().toISOString(),
      database,
      tables: data,
      summary,
    };

    const stamp = payload.createdAt.replace(/[:.]/g, '-').slice(0, 19);
    const filename = `nomchael-backup-${stamp}.json`;
    const json = JSON.stringify(payload, this.jsonReplacer, 2);
    const buffer = Buffer.from(json, 'utf8');

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId || null,
          action: 'DATABASE_BACKUP',
          entityType: 'Database',
          entityId: null,
          metadata: {
            filename,
            tableCount: summary.length,
            totalRows: summary.reduce((n, t) => n + t.rowCount, 0),
            bytes: buffer.length,
          },
        },
      });
    } catch {
      /* audit must not block download */
    }

    if (!buffer.length) {
      throw new InternalServerErrorException('Backup file was empty');
    }

    return { filename, buffer, summary };
  }

  private normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = this.normalizeValue(value);
    }
    return out;
  }

  private normalizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return { __type: 'Buffer', data: value.toString('base64') };
    if (
      value != null &&
      typeof value === 'object' &&
      typeof (value as { toFixed?: unknown }).toFixed === 'function' &&
      ((value as { constructor?: { name?: string } }).constructor?.name === 'Decimal' ||
        typeof (value as { toString?: unknown }).toString === 'function')
    ) {
      const asAny = value as { constructor?: { name?: string }; toString: () => string };
      if (asAny.constructor?.name === 'Decimal') return asAny.toString();
    }
    return value;
  }

  private jsonReplacer(_key: string, value: unknown) {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
}
