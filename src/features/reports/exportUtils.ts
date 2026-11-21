import type {ImportRowInput} from '@/types/reports';

const FORMULA_TRIGGER_REGEX = /^[\s\uFEFF\xA0]*[=+\-@\t\r]/;

/**
 * Neutralizes CSV / Excel formula injection (OWASP CSV Injection mitigation)
 * and properly escapes RFC-4180 quotes/commas/newlines.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);
  if (FORMULA_TRIGGER_REGEX.test(str)) {
    str = `'${str}`;
  }

  const needsQuotes = /[",\n\r;]/.test(str);
  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildSafeCsvContent(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(','));
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}`;
}

export function downloadCsvFile(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): void {
  const content = buildSafeCsvContent(headers, rows);
  const blob = new Blob([content], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SHIPMENTS_V1_TEMPLATE_HEADERS: readonly string[] = [
  'رقم_السطر',
  'كود_العميل',
  'الخدمة',
  'نوع_الطلب',
  'نوع_الدفع',
  'شامل_الشحن',
  'اسم_المستلم',
  'موبايل_المستلم',
  'تليفون_المستلم',
  'المحافظة',
  'المنطقة',
  'العنوان',
  'الوزن_كجم',
  'عدد_القطع',
  'مبلغ_التحصيل',
  'وصف_الطرد',
  'المرجع_الخارجي',
  'فتح_الطرد',
  'وصف_الاستبدال',
];

export const SHIPMENTS_V1_SAMPLE_ROW: readonly string[] = [
  '1',
  'C-0001',
  'STD',
  'FDP',
  'COD',
  'no',
  'أحمد محمود',
  '01012345678',
  '0224001122',
  'القاهرة',
  'مدينة نصر',
  'شارع عباس العقاد عمارة 12',
  '1.5',
  '1',
  '500',
  'ملابس رياضية',
  'ORD-1001',
  'yes',
  '',
];

export function downloadShipmentsTemplateCsv(): void {
  downloadCsvFile(
    'shipments_import_template_v1.csv',
    SHIPMENTS_V1_TEMPLATE_HEADERS,
    [SHIPMENTS_V1_SAMPLE_ROW],
  );
}

const HEADER_ALIAS_MAP: Record<string, keyof ImportRowInput> = {
  رقم_السطر: 'row_number',
  row_number: 'row_number',
  line_number: 'row_number',
  كود_العميل: 'client_code',
  العميل: 'client_code',
  client_code: 'client_code',
  client: 'client_code',
  الخدمة: 'service_code',
  service_code: 'service_code',
  service: 'service_code',
  نوع_الطلب: 'shipment_type_code',
  shipment_type_code: 'shipment_type_code',
  shipment_type: 'shipment_type_code',
  نوع_الدفع: 'payment_term_code',
  payment_term_code: 'payment_term_code',
  payment_term: 'payment_term_code',
  شامل_الشحن: 'price_mode',
  price_mode: 'price_mode',
  shipping_included: 'price_mode',
  اسم_المستلم: 'recipient_name',
  recipient_name: 'recipient_name',
  موبايل_المستلم: 'recipient_mobile',
  recipient_mobile: 'recipient_mobile',
  تليفون_المستلم: 'recipient_phone',
  recipient_phone: 'recipient_phone',
  المحافظة: 'governorate',
  governorate: 'governorate',
  المنطقة: 'region',
  region: 'region',
  العنوان: 'recipient_address',
  recipient_address: 'recipient_address',
  address: 'recipient_address',
  الوزن_كجم: 'weight_kg',
  الوزن: 'weight_kg',
  weight_kg: 'weight_kg',
  weight: 'weight_kg',
  عدد_القطع: 'pieces_count',
  pieces_count: 'pieces_count',
  pieces: 'pieces_count',
  مبلغ_التحصيل: 'cod_amount',
  cod_amount: 'cod_amount',
  amount: 'cod_amount',
  وصف_الطرد: 'package_description',
  package_description: 'package_description',
  المرجع_الخارجي: 'external_reference',
  external_reference: 'external_reference',
  فتح_الطرد: 'allow_package_opening',
  allow_package_opening: 'allow_package_opening',
  وصف_الاستبدال: 'exchange_item_description',
  exchange_item_description: 'exchange_item_description',
};

function detectDelimiter(headerLine: string): string {
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  if (tabCount >= commaCount && tabCount >= semiCount && tabCount > 0) return '\t';
  if (semiCount > commaCount) return ';';
  return ',';
}

function splitDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell !== '')) {
    rows.push(currentRow);
  }
  return rows;
}

export function parseCsvText(rawText: string): ImportRowInput[] {
  const cleaned = rawText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    throw new Error('المحتوى فارغ. يُرجى اختيار ملف CSV/TSV أو لصق البيانات أولاً.');
  }

  const firstNewline = cleaned.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? cleaned : cleaned.slice(0, firstNewline);
  const delimiter = detectDelimiter(firstLine);
  const matrix = splitDelimitedRows(cleaned, delimiter);

  if (matrix.length < 2) {
    throw new Error('يجب أن يحتوي الملف على سطر العناوين وصف واحد على الأقل من البيانات.');
  }

  const rawHeaders = matrix[0];
  const mappedKeys: (keyof ImportRowInput | null)[] = rawHeaders.map((h) => {
    const normalized = h.trim().toLowerCase();
    return HEADER_ALIAS_MAP[h.trim()] ?? HEADER_ALIAS_MAP[normalized] ?? null;
  });

  if (!mappedKeys.some((k) => k === 'recipient_name' || k === 'recipient_mobile')) {
    throw new Error(
      'عناوين الأعمدة غير مطابقة لقالب SHIPMENTS_V1. يُرجى استخدام القالب المعتمد (اسم_المستلم، موبايل_المستلم، المحافظة، المنطقة...).',
    );
  }

  return matrix.slice(1).map((cols, index) => {
    const draft: Record<string, string | number> = {
      row_number: index + 1,
      client_code: '',
      service_code: 'STD',
      shipment_type_code: 'FDP',
      payment_term_code: 'COD',
      price_mode: 'no',
      recipient_name: '',
      recipient_mobile: '',
      recipient_phone: '',
      governorate: '',
      region: '',
      recipient_address: '',
      weight_kg: '1',
      pieces_count: '1',
      cod_amount: '0',
      package_description: '',
      external_reference: '',
      allow_package_opening: 'no',
      exchange_item_description: '',
    };

    mappedKeys.forEach((key, colIdx) => {
      if (!key) return;
      const val = (cols[colIdx] ?? '').trim();
      if (key === 'row_number') {
        const parsedNum = Number.parseInt(val, 10);
        if (Number.isFinite(parsedNum) && parsedNum > 0) {
          draft.row_number = parsedNum;
        }
      } else {
        draft[key] = val;
      }
    });

    return draft as unknown as ImportRowInput;
  });
}

export interface BarcodeBar {
  readonly x: number;
  readonly width: number;
}

/**
 * Generates deterministic high-contrast SVG vector bar geometry for any barcode token
 * so thermal labels & A4 waybills print cleanly without relying on canvas or third-party fonts.
 */
export function buildBarcodeBars(token: string): {bars: readonly BarcodeBar[]; totalWidth: number} {
  const safe = token.trim() || 'SFB-0000000000';
  const bars: BarcodeBar[] = [];
  let cursor = 0;

  // Quiet start guard bars
  bars.push({x: cursor, width: 2});
  cursor += 4;
  bars.push({x: cursor, width: 1});
  cursor += 3;

  for (let i = 0; i < safe.length; i++) {
    const code = safe.charCodeAt(i);
    const bar1 = ((code >> 0) & 3) + 1;
    const space1 = ((code >> 2) & 1) + 1;
    const bar2 = ((code >> 4) & 2) + 1;
    const space2 = ((code >> 6) & 1) + 1;

    bars.push({x: cursor, width: bar1});
    cursor += bar1 + space1;
    bars.push({x: cursor, width: bar2});
    cursor += bar2 + space2;
  }

  // Stop guard bars
  bars.push({x: cursor, width: 1});
  cursor += 3;
  bars.push({x: cursor, width: 2});
  cursor += 2;

  return {bars, totalWidth: cursor};
}