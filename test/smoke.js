// Дымовой тест: сервер как MCP-клиент; создаёт реальные PDF и PNG во временной папке и проверяет расчёты.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ru-docs-'));
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/index.js'], env: { ...process.env, RU_DOCS_DIR: dir } }));

const { tools } = await client.listTools();
console.log(`tools (${tools.length}):`, tools.map(t => t.name).join(', '));
let failed = 0;
if (tools.length !== 4) { console.log('FAIL ожидалось 4 инструмента'); failed++; }

async function run(name, args, check) {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text || '';
  let ok;
  try { ok = check(r.isError ? null : JSON.parse(t), t, r.isError, r); } catch { ok = false; }
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
}

// Реальные открытые реквизиты ПАО Сбербанк — только как корректные по контрольным суммам данные
const seller = {
  name: 'ИП Петров Пётр Петрович', inn: '500100732259', address: 'г. Москва', bank_name: 'ПАО Сбербанк',
  bik: '044525225', account: '40802810938000000001', correspondent_account: '30101810400000000225', signer: 'Петров П. П.',
};
const buyer = { name: 'ПАО Сбербанк', inn: '7707083893', kpp: '773601001', address: 'г. Москва, ул. Вавилова, д. 19' };
const items = [{ name: 'Разработка лендинга', price: 45000 }, { name: 'Поддержка сайта, часов', quantity: 12.5, unit: 'ч', price: 1500.5 }];

// Счёт с корректным ключом счёта: подбираем последнюю цифру под БИК
function fixAccount(bik, acc19) {
  for (let k = 0; k < 10; k++) {
    const a = acc19 + k;
    const d = [...(bik.slice(-3) + a)].map(Number);
    if (d.reduce((s, x, i) => s + x * [7, 1, 3][i % 3], 0) % 10 === 0) return a;
  }
}
seller.account = fixAccount(seller.bik, '4080281093800000000');

const pdfOk = (d, r) => fs.existsSync(d.file) && fs.readFileSync(d.file).subarray(0, 5).toString() === '%PDF-'
  && r.content[1]?.resource?.mimeType === 'application/pdf' && fs.statSync(d.file).size > 5000;

await run('invoice_create', { number: '15', date: '2026-09-29', seller, buyer, items, due_date: '2026-10-06', purpose: 'Договор № 7 от 01.09.2026' },
  (d, t, e, r) => d.sum === 63756.25 && d.total === 63756.25 && d.vat_amount === 0
    && d.total_words === 'Шестьдесят три тысячи семьсот пятьдесят шесть рублей 25 копеек'
    && d.qr_payload.startsWith('ST00012|Name=ИП Петров Пётр Петрович|PersonalAcc=' + seller.account) && d.qr_payload.includes('|Sum=6375625|')
    && pdfOk(d, r));
await run('invoice_create', { number: '16', seller: { ...seller, name: 'ООО «Ромашка»', inn: '7707083893', kpp: '773601001' }, buyer, items: [{ name: 'Товар', quantity: 2, price: 600 }], vat: '20' },
  d => d.total === 1200 && d.vat_amount === 200);
await run('invoice_create', { number: '17', seller, buyer, items: [{ name: 'Товар', price: 1000 }], vat: '22', vat_included: false },
  d => d.sum === 1000 && d.vat_amount === 220 && d.total === 1220);
await run('invoice_create', { number: '18', seller: { ...seller, inn: '500100732258' }, buyer, items },
  (d, t, e) => e && t.includes('контрольная сумма ИНН'));
await run('invoice_create', { number: '19', seller: { ...seller, account: '40802810938000000009' }, buyer, items },
  (d, t, e) => e && t.includes('не соответствует БИК'));
await run('act_create', { number: '15', date: '2026-09-30', seller: { name: seller.name, inn: seller.inn, signer: 'Петров П. П.' }, buyer, items, period: 'сентябрь 2026' },
  (d, t, e, r) => d.total === 63756.25 && pdfOk(d, r));
await run('payment_qr', { recipient: seller, amount: 1500, purpose: 'Оплата консультации | срочно' },
  (d, t, e, r) => fs.existsSync(d.file) && r.content[1].type === 'image' && d.payload.includes('Purpose=Оплата консультации / срочно') && d.amount_words === 'Одна тысяча пятьсот рублей 00 копеек');
await run('amount_in_words', { amount: 21001.01 }, d => d.words === 'Двадцать одна тысяча один рубль 01 копейка');
await run('amount_in_words', { amount: 2, currency: 'USD', minor_in_words: true }, d => d.words === 'Два доллара США ноль центов');
await run('amount_in_words', { amount: 1000002, currency: 'none' }, d => d.words === 'один миллион два');

await client.close();
console.log(`\nфайлы: ${dir}`);
console.log(failed ? `Провалено: ${failed}` : 'Все проверки пройдены');
process.exit(failed ? 1 : 0);
