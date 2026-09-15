import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';

@Injectable()
export class PrintingService {
  private readonly logger = new Logger(PrintingService.name);

  constructor(private config: ConfigService) {}

  buildEscPosReceipt(data: {
    companyName: string;
    receiptNumber: string;
    clientName: string;
    projectName: string;
    amount: string;
    method: string;
    paidAt: string;
  }): Buffer {
    const lines: string[] = [];
    const ESC = '\x1B';
    const GS = '\x1D';
    lines.push(`${ESC}@`); // init
    lines.push(`${ESC}a\x01`); // center
    lines.push(`${ESC}!\x30${data.companyName}\n`);
    lines.push(`${ESC}!\x00`);
    lines.push('PAYMENT RECEIPT\n');
    lines.push('--------------------------------\n');
    lines.push(`${ESC}a\x00`);
    lines.push(`Receipt: ${data.receiptNumber}\n`);
    lines.push(`Date: ${data.paidAt}\n`);
    lines.push(`Client: ${data.clientName}\n`);
    lines.push(`Project: ${data.projectName}\n`);
    lines.push(`Method: ${data.method}\n`);
    lines.push('--------------------------------\n');
    lines.push(`${ESC}!\x20Amount: ${data.amount}\n`);
    lines.push(`${ESC}!\x00`);
    lines.push('--------------------------------\n');
    lines.push(`${ESC}a\x01Thank you\n\n\n`);
    lines.push(`${GS}V\x00`); // cut
    return Buffer.from(lines.join(''), 'ascii');
  }

  async printReceipt(payload: {
    receiptNumber: string;
    clientName: string;
    projectName: string;
    amountCents: number;
    method: string;
    paidAt: Date;
  }) {
    const companyName = this.config.get('COMPANY_NAME') || 'Nomchael Construction';
    const currency = this.config.get('CURRENCY') || 'USD';
    const amount = `${currency} ${(payload.amountCents / 100).toFixed(2)}`;
    const buffer = this.buildEscPosReceipt({
      companyName,
      receiptNumber: payload.receiptNumber,
      clientName: payload.clientName,
      projectName: payload.projectName,
      amount,
      method: payload.method,
      paidAt: payload.paidAt.toISOString(),
    });

    const host = this.config.get<string>('EPSON_PRINTER_HOST');
    const port = Number(this.config.get('EPSON_PRINTER_PORT') || 9100);

    if (!host) {
      this.logger.warn(`Epson stub print receipt ${payload.receiptNumber}`);
      return { stub: true, bytes: buffer.length, preview: buffer.toString('utf8').slice(0, 200) };
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write(buffer, (err) => {
          socket.end();
          if (err) reject(err);
          else resolve();
        });
      });
      socket.on('error', reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('Printer timeout'));
      });
    });

    return { stub: false, printed: true };
  }
}
