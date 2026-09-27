import PDFDocument from 'pdfkit';

const MONEY_LABEL =
  /(quoted|discount$|discounts|net due|cash|fund uses|available|owes|amount|labour used|expenses|borrow|repay|revenue|profit|wages|still)/i;
const NOT_MONEY_LABEL = /(reason|stage|\bcount\b|houses|\bunit\b|code|phone|kind)/i;

type Block = unknown[][];

function splitBlocks(rows: unknown[][]): Block[] {
  const blocks: Block[] = [];
  let current: Block = [];
  for (const r of rows) {
    if (!r.length || r.every((c) => c === '' || c === null || c === undefined)) {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(r);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/**
 * Renders the same row arrays used for CSV exports as a PDF.
 * Blank rows separate sections. The first section is drawn as label/value pairs
 * unless `firstBlockIsTable` is set; every other section is a table whose first row is the header.
 */
export function buildTablePdf(opts: {
  title: string;
  subtitle?: string;
  rows: unknown[][];
  company?: string;
  currency?: string;
  firstBlockIsTable?: boolean;
}): Promise<Buffer> {
  const company = opts.company || process.env.COMPANY_NAME || 'Nomchael Construction';
  const currency = opts.currency || process.env.CURRENCY || 'USD';
  const blocks = splitBlocks(opts.rows);
  const maxCols = Math.max(1, ...opts.rows.map((r) => r.length));
  const landscape = maxCols > 7;

  const fmtMoney = (v: unknown) => {
    const n = Number(v);
    if (v === '' || v === null || v === undefined || Number.isNaN(n)) return String(v ?? '');
    return `${currency} ${n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };
  const isMoneyLabel = (label: unknown) => {
    const s = String(label ?? '');
    return MONEY_LABEL.test(s) && !NOT_MONEY_LABEL.test(s);
  };
  const cellText = (v: unknown, header: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' && isMoneyLabel(header)) return fmtMoney(v);
    return String(v);
  };

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      layout: landscape ? 'landscape' : 'portrait',
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;
    let y = doc.page.margins.top;

    const newPage = () => {
      doc.addPage();
      y = doc.page.margins.top;
    };
    const ensure = (need: number) => {
      if (y + need > bottom) newPage();
    };

    doc.fontSize(16).fillColor('#0f172a').text(company, left, y);
    y += 20;
    doc.fontSize(11).fillColor('#334155').text(opts.title.toUpperCase(), left, y);
    y += 15;
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(
        `${opts.subtitle ? `${opts.subtitle}  |  ` : ''}Generated ${new Date()
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ')}`,
        left,
        y,
      );
    y += 14;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
    y += 10;

    const drawKeyValues = (block: Block) => {
      for (const r of block) {
        const label = String(r[0] ?? '');
        const value = r.length > 1 ? cellText(r[1], label) : '';
        ensure(16);
        doc.fontSize(9).fillColor('#64748b').text(label, left, y, { width: 180 });
        doc.fillColor('#0f172a').text(value, left + 190, y, { width: width - 190 });
        y += 14;
      }
      y += 8;
    };

    const drawTable = (block: Block) => {
      const header = block[0].map((h) => String(h ?? ''));
      const body = block.slice(1);
      const cols = header.length;
      const fontSize = cols > 9 ? 7 : 8;
      const pad = 3;

      doc.fontSize(fontSize);
      const weights = header.map((h, i) => {
        const longest = Math.max(
          doc.widthOfString(h),
          ...body.slice(0, 200).map((r) => doc.widthOfString(cellText(r[i], h))),
        );
        return Math.min(Math.max(longest, 30), 180);
      });
      const total = weights.reduce((s, w) => s + w, 0);
      const colWidths = weights.map((w) => (w / total) * width);

      const rowHeight = (cells: string[]) =>
        Math.max(
          ...cells.map((c, i) =>
            doc.heightOfString(c || ' ', { width: colWidths[i] - pad * 2 }),
          ),
        ) +
        pad * 2;

      const drawRow = (cells: string[], opts2: { head?: boolean; shade?: boolean }) => {
        const h = rowHeight(cells);
        if (y + h > bottom) {
          newPage();
          if (!opts2.head) drawRow(header, { head: true });
        }
        if (opts2.head || opts2.shade) {
          doc
            .rect(left, y, width, h)
            .fill(opts2.head ? '#f1f5f9' : '#fafafa');
        }
        let x = left;
        cells.forEach((c, i) => {
          doc
            .fontSize(fontSize)
            .fillColor(opts2.head ? '#334155' : '#0f172a')
            .text(c, x + pad, y + pad, { width: colWidths[i] - pad * 2 });
          x += colWidths[i];
        });
        y += h;
        doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#e5e7eb').stroke();
      };

      ensure(40);
      drawRow(header, { head: true });
      body.forEach((r, idx) => {
        const cells = header.map((h, i) => cellText(r[i], h));
        drawRow(cells, { shade: idx % 2 === 1 });
      });
      y += 12;
    };

    blocks.forEach((block, i) => {
      if (i === 0 && !opts.firstBlockIsTable) drawKeyValues(block);
      else drawTable(block);
    });

    if (!blocks.length) {
      doc.fontSize(9).fillColor('#64748b').text('No data.', left, y);
    }

    doc.end();
  });
}
