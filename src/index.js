#!/usr/bin/env node
// MCP-сервер «Документы РФ»: счёт на оплату с QR-кодом, акт выполненных работ, платёжный QR, сумма прописью — в PDF, без токенов.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { amountInWords, numberToWords, formatMoney } from './words.js';
import { validateParty, computeTotals, paymentQrPayload } from './model.js';
import { renderInvoice, renderAct } from './render.js';

const server = new McpServer({ name: 'ru-docs', version: '1.0.1' }, {
  instructions: 'Бухгалтерские документы РФ в PDF: счёт на оплату (с QR-кодом для оплаты из банковского приложения), акт выполненных работ, ' +
    'платёжный QR, сумма прописью. Реквизиты сторон (ИНН, КПП, БИК, счёт) проверяются по контрольным суммам до создания файла. ' +
    'Если реквизитов нет, спросите пользователя или возьмите их из сервера проверки контрагентов (например ru-business-mcp: company_check, bank_by_bik). ' +
    'Файлы сохраняются локально, путь возвращается в ответе. Russian invoices, acts and payment QR codes as PDF.',
});

const OUT_DIR = process.env.RU_DOCS_DIR || path.join(os.homedir(), 'Documents', 'ru-docs');

const text = data => ({ type: 'text', text: JSON.stringify(data, null, 2) });
const fail = e => ({ isError: true, content: [{ type: 'text', text: 'Ошибка: ' + (e?.message || String(e)) }] });
const today = () => new Date().toISOString().slice(0, 10);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Party = z.object({
  name: z.string().min(1).describe('Название: «ООО „Ромашка“» или «ИП Иванов Иван Иванович»'),
  inn: z.string().describe('ИНН: 10 цифр у организации, 12 у ИП'),
  kpp: z.string().optional().describe('КПП (только у организаций)'),
  address: z.string().optional().describe('Юридический адрес'),
  phone: z.string().optional(),
  bank_name: z.string().optional().describe('Банк, например «ПАО Сбербанк»'),
  bik: z.string().optional().describe('БИК банка, 9 цифр'),
  account: z.string().optional().describe('Расчётный счёт, 20 цифр'),
  correspondent_account: z.string().optional().describe('Корреспондентский счёт банка, 20 цифр'),
  signer: z.string().optional().describe('Кто подписывает: «Иванов И. И.»'),
  accountant: z.string().optional().describe('Главный бухгалтер (если есть)'),
});
const Item = z.object({
  name: z.string().min(1).describe('Наименование товара, работы или услуги'),
  quantity: z.number().positive().default(1),
  unit: z.string().optional().describe('Единица: шт, усл., ч, мес. (по умолчанию шт)'),
  price: z.number().min(0).describe('Цена за единицу в рублях'),
});
const Vat = z.enum(['none', '0', '5', '7', '10', '20', '22']).default('none')
  .describe('НДС: none — без НДС (УСН, самозанятые, ИП на патенте), иначе ставка в процентах');

function outPath(kind, number, dir) {
  const d = dir || OUT_DIR;
  fs.mkdirSync(d, { recursive: true });
  const safe = String(number).replace(/[^\p{L}\p{N}_-]+/gu, '_');
  return path.join(d, `${kind}_${safe}_${Date.now().toString(36)}.pdf`);
}

async function pdfResult(file, meta) {
  const b = fs.readFileSync(file);
  return {
    content: [
      text({ file, size_kb: Math.round(b.length / 1024), ...meta }),
      { type: 'resource', resource: { uri: 'file:///' + file.replace(/\\/g, '/'), mimeType: 'application/pdf', blob: b.toString('base64') } },
    ],
  };
}

const docInput = {
  number: z.string().min(1).describe('Номер документа, например «15» или «2026-015»'),
  date: DateStr.optional().describe('Дата документа ГГГГ-ММ-ДД (по умолчанию сегодня)'),
  seller: Party.describe('Поставщик / исполнитель (вы)'),
  buyer: Party.describe('Покупатель / заказчик'),
  items: z.array(Item).min(1).max(200).describe('Позиции документа'),
  vat: Vat,
  vat_included: z.boolean().default(true).describe('Цены уже включают НДС (по умолчанию да); false — НДС начисляется сверху'),
  purpose: z.string().optional().describe('Основание: «Договор № 7 от 01.09.2026»'),
  output_dir: z.string().optional().describe('Папка для PDF (по умолчанию ~/Documents/ru-docs или RU_DOCS_DIR)'),
};

server.registerTool('invoice_create', {
  title: 'Счёт на оплату (PDF с QR-кодом)',
  description: 'Создаёт счёт на оплату в PDF по типовой форме: банковский блок получателя, поставщик и покупатель, таблица позиций, итог, НДС ' +
    '(или «Без НДС»), сумма прописью, подписи и QR-код оплаты по ГОСТ Р 56042 — покупатель сканирует его в приложении банка, ' +
    'и все реквизиты с суммой подставляются сами. Перед созданием проверяет ИНН, КПП, БИК и соответствие счёта БИК; при ошибках файл не создаётся. ' +
    'Возвращает путь к файлу, итоги (sum, vat_amount, total, total_words) и сам PDF. Для закрывающего документа используйте act_create, ' +
    'только QR без счёта — payment_qr. Пишет файл на диск; сеть не нужна.',
  inputSchema: {
    ...docInput,
    due_date: DateStr.optional().describe('Оплатить до, ГГГГ-ММ-ДД'),
    with_qr: z.boolean().default(true).describe('Добавить QR-код оплаты (нужны банковские реквизиты продавца)'),
    note: z.string().optional().describe('Примечание внизу счёта'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async a => {
  try {
    const errs = [...validateParty(a.seller, 'Поставщик', { needBank: true }), ...validateParty(a.buyer, 'Покупатель', { needBank: false })];
    if (errs.length) throw new Error('исправьте реквизиты:\n- ' + errs.join('\n- '));
    const date = a.date || today();
    const t = computeTotals(a.items, a.vat, a.vat_included);
    const purpose = a.purpose || `Оплата по счёту № ${a.number} от ${date.split('-').reverse().join('.')}`;
    const qrPurpose = `Оплата по счёту № ${a.number} от ${date.split('-').reverse().join('.')}. ${t.vat === 'none' ? 'Без НДС' : `В т.ч. НДС ${formatMoney(t.vat_amount)} руб.`}`;
    const qr = a.with_qr ? paymentQrPayload(a.seller, t.total, qrPurpose) : null;
    const file = outPath('schet', a.number, a.output_dir);
    await renderInvoice(file, { number: a.number, date, seller: a.seller, buyer: a.buyer, totals: t, qr, purpose, due_date: a.due_date, note: a.note });
    return pdfResult(file, { document: 'Счёт на оплату', number: a.number, date, sum: t.sum, vat_amount: t.vat_amount, total: t.total, total_words: t.total_words, qr_payload: qr || undefined });
  } catch (e) { return fail(e); }
});

server.registerTool('act_create', {
  title: 'Акт выполненных работ (PDF)',
  description: 'Создаёт акт выполненных работ (оказанных услуг) в PDF: исполнитель, заказчик, основание, период, таблица услуг, итог с НДС или без, ' +
    'сумма прописью, стандартная фраза об отсутствии претензий и места для подписей обеих сторон. ' +
    'Используйте как закрывающий документ после оплаты или выполнения работ; счёт выставляет invoice_create (позиции можно передать те же). ' +
    'Реквизиты проверяются по контрольным суммам, банковские данные для акта не обязательны. Возвращает путь к файлу, итоги и PDF. Пишет файл на диск; сеть не нужна.',
  inputSchema: {
    ...docInput,
    period: z.string().optional().describe('Период оказания услуг: «сентябрь 2026» или «01.09.2026–30.09.2026»'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async a => {
  try {
    const errs = [...validateParty(a.seller, 'Исполнитель', { needBank: false }), ...validateParty(a.buyer, 'Заказчик', { needBank: false })];
    if (errs.length) throw new Error('исправьте реквизиты:\n- ' + errs.join('\n- '));
    const date = a.date || today();
    const t = computeTotals(a.items, a.vat, a.vat_included);
    const file = outPath('akt', a.number, a.output_dir);
    await renderAct(file, { number: a.number, date, seller: a.seller, buyer: a.buyer, totals: t, purpose: a.purpose, period: a.period });
    return pdfResult(file, { document: 'Акт', number: a.number, date, sum: t.sum, vat_amount: t.vat_amount, total: t.total, total_words: t.total_words });
  } catch (e) { return fail(e); }
});

server.registerTool('payment_qr', {
  title: 'QR-код для оплаты по реквизитам',
  description: 'Делает QR-код оплаты по ГОСТ Р 56042 (формат ST00012, UTF-8), который понимают приложения Сбербанка, Т-Банка, ВТБ, Альфа и других: ' +
    'клиент сканирует его и получает заполненную платёжку с получателем, счётом, суммой и назначением. ' +
    'Удобно отправить в мессенджер вместо реквизитов. Возвращает PNG (картинку и путь к файлу) и строку payload. ' +
    'Если нужен полноценный счёт с QR внутри — invoice_create. Реквизиты получателя проверяются. Пишет PNG на диск; сеть не нужна.',
  inputSchema: {
    recipient: Party.describe('Получатель платежа: name, inn, bank_name, bik, account, при наличии kpp и correspondent_account'),
    amount: z.number().positive().describe('Сумма в рублях'),
    purpose: z.string().min(1).max(210).describe('Назначение платежа, например «Оплата по счёту № 15 от 29.09.2026. Без НДС»'),
    output_dir: z.string().optional().describe('Папка для PNG (по умолчанию ~/Documents/ru-docs)'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ recipient, amount, purpose, output_dir }) => {
  try {
    const errs = validateParty(recipient, 'Получатель', { needBank: true });
    if (errs.length) throw new Error('исправьте реквизиты:\n- ' + errs.join('\n- '));
    const payload = paymentQrPayload(recipient, amount, purpose);
    const png = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
    const d = output_dir || OUT_DIR;
    fs.mkdirSync(d, { recursive: true });
    const file = path.join(d, `qr_${Date.now().toString(36)}.png`);
    fs.writeFileSync(file, png);
    return { content: [text({ file, amount, amount_words: amountInWords(amount), payload }), { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  } catch (e) { return fail(e); }
});

server.registerTool('amount_in_words', {
  title: 'Сумма прописью',
  description: 'Переводит сумму в текст по правилам делопроизводства: «Сто двенадцать рублей 01 копейка» (копейки цифрами, как в счетах) ' +
    'или полностью словами. Поддерживает RUB, USD, EUR, CNY; для просто числа прописью (без валюты) передайте currency=none. ' +
    'Используйте для договоров, расписок, платёжек; счета и акты из invoice_create/act_create уже содержат сумму прописью. Только вычисление, без сети.',
  inputSchema: {
    amount: z.number().min(0).describe('Сумма, например 1234567.89'),
    currency: z.enum(['RUB', 'USD', 'EUR', 'CNY', 'none']).default('RUB').describe('Валюта или none — только число'),
    minor_in_words: z.boolean().default(false).describe('Копейки/центы тоже словами (по умолчанию цифрами)'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ amount, currency, minor_in_words }) => {
  try {
    if (currency === 'none') {
      if (!Number.isInteger(amount)) throw new Error('Для currency=none нужно целое число');
      return { content: [text({ amount, words: numberToWords(amount) })] };
    }
    return { content: [text({ amount, currency, words: amountInWords(amount, currency, { minorInWords: minor_in_words }), formatted: formatMoney(amount) })] };
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
