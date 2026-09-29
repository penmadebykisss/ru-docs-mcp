// PDF счёта и акта: pdfkit, шрифт DejaVu Sans (кириллица, свободная лицензия), QR-код оплаты.

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { ruDate } from './model.js';
import { formatMoney } from './words.js';

const require = createRequire(import.meta.url);
const fontDir = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf').replace(/DejaVuSans\.ttf$/, '');
const FONT = fontDir + 'DejaVuSans.ttf';
const BOLD = fontDir + 'DejaVuSans-Bold.ttf';

const L = 40, W = 515; // поля A4 и ширина полосы

function partyLine(p) {
  return [p.name, `ИНН ${p.inn}`, p.kpp && `КПП ${p.kpp}`, p.address, p.phone && `тел. ${p.phone}`].filter(Boolean).join(', ');
}

function table(doc, rows, cols, firstTitle) {
  if (firstTitle) cols = cols.map((c, i) => i === 1 ? { ...c, title: firstTitle } : c);
  let y = doc.y;
  const drawRow = (cells, bold) => {
    doc.font(bold ? BOLD : FONT).fontSize(8.5);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i].w - 6 }))) + 6;
    if (y + h > 800) { doc.addPage(); y = 40; }
    let x = L;
    cells.forEach((c, i) => {
      doc.rect(x, y, cols[i].w, h).stroke();
      doc.text(String(c), x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].align || 'left' });
      x += cols[i].w;
    });
    y += h;
  };
  drawRow(cols.map(c => c.title), true);
  rows.forEach(r => drawRow(r));
  doc.y = y + 6;
  doc.x = L;
}

function totals(doc, t) {
  doc.font(BOLD).fontSize(9);
  const line = (label, value) => doc.text(`${label}  ${value}`, L, doc.y, { width: W, align: 'right' });
  line('Итого:', formatMoney(t.sum));
  line(t.vat_label + ':', t.vat === 'none' ? '—' : formatMoney(t.vat_amount));
  if (t.vat !== 'none' && !t.vat_included) line('Всего к оплате:', formatMoney(t.total));
  doc.moveDown(0.5).font(FONT).fontSize(9)
    .text(`Всего наименований ${t.rows.length}, на сумму ${t.total_text} руб.`, L, doc.y, { width: W })
    .font(BOLD).text(t.total_words, { width: W });
}

function signatures(doc, left, right) {
  doc.moveDown(2);
  const y = doc.y;
  doc.font(FONT).fontSize(9);
  const h = Math.max(doc.heightOfString(left, { width: 250 }), doc.heightOfString(right, { width: 250 }));
  doc.text(left, L, y, { width: 250 });
  doc.text(right, L + 265, y, { width: 250 });
  const ly = y + h + 26;
  doc.moveTo(L, ly).lineTo(L + 230, ly).stroke();
  doc.moveTo(L + 265, ly).lineTo(L + 495, ly).stroke();
  doc.fontSize(7).text('подпись', L, ly + 2, { width: 230, align: 'center' }).text('подпись', L + 265, ly + 2, { width: 230, align: 'center' });
  doc.y = ly + 14;
}

const ITEM_COLS = [
  { title: '№', w: 25, align: 'center' }, { title: 'Товары (работы, услуги)', w: 245 },
  { title: 'Кол-во', w: 50, align: 'right' }, { title: 'Ед.', w: 35, align: 'center' },
  { title: 'Цена', w: 75, align: 'right' }, { title: 'Сумма', w: 85, align: 'right' },
];
const qty = q => String(q).replace('.', ',');
const itemRows = t => t.rows.map(r => [r.n, r.name, qty(r.quantity), r.unit, formatMoney(r.price), formatMoney(r.sum)]);

function finish(doc, path) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path);
    out.on('finish', resolve).on('error', reject);
    doc.pipe(out);
    doc.end();
  });
}

export async function renderInvoice(path, { number, date, seller, buyer, totals: t, qr, purpose, due_date, note }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Счёт № ${number}`, Author: seller.name } });
  doc.lineWidth(0.6);

  // Банковский блок, как в типовой форме счёта
  const top = 40;
  const bank = [
    [seller.bank_name, 'БИК', seller.bik],
    ['Банк получателя', 'Сч. №', seller.correspondent_account || ''],
    [`ИНН ${seller.inn}${seller.kpp ? '   КПП ' + seller.kpp : ''}`, 'Сч. №', seller.account],
    [seller.name, '', ''],
    ['Получатель', '', ''],
  ];
  const qrSize = qr ? 95 : 0;
  const bw = W - (qr ? qrSize + 10 : 0);
  const c1 = bw - 170;
  doc.font(FONT).fontSize(8.5);
  bank.forEach(([a, b, c], i) => {
    const y = top + i * 17;
    doc.text(a, L + 3, y + 4, { width: c1 - 6, lineBreak: false, ellipsis: true });
    doc.text(b, L + c1 + 3, y + 4, { width: 44 });
    doc.text(c, L + c1 + 50, y + 4, { width: 118 });
  });
  doc.rect(L, top, bw, 85).stroke();
  doc.moveTo(L + c1, top).lineTo(L + c1, top + 85).stroke();
  doc.moveTo(L + c1 + 47, top).lineTo(L + c1 + 47, top + 85).stroke();
  doc.moveTo(L, top + 34).lineTo(L + bw, top + 34).stroke();
  doc.moveTo(L, top + 51).lineTo(L + c1, top + 51).stroke();
  if (qr) {
    const png = await QRCode.toBuffer(qr, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
    doc.image(png, L + W - qrSize, top - 5, { width: qrSize });
    doc.fontSize(6).text('Оплата по QR', L + W - qrSize, top + qrSize - 3, { width: qrSize, align: 'center' });
  }

  doc.font(BOLD).fontSize(14).text(`Счёт на оплату № ${number} от ${ruDate(date)}`, L, top + 105, { width: W });
  doc.moveTo(L, doc.y + 4).lineTo(L + W, doc.y + 4).lineWidth(1.5).stroke().lineWidth(0.6);
  doc.moveDown(0.8).font(FONT).fontSize(9);
  doc.text(`Поставщик (исполнитель): ${partyLine(seller)}`, L, doc.y, { width: W }).moveDown(0.4);
  doc.text(`Покупатель (заказчик): ${partyLine(buyer)}`, L, doc.y, { width: W }).moveDown(0.4);
  if (purpose) doc.text(`Основание: ${purpose}`, L, doc.y, { width: W });
  doc.moveDown(0.6);

  table(doc, itemRows(t), ITEM_COLS);
  totals(doc, t);
  doc.moveDown(0.6).font(FONT).fontSize(8.5);
  if (due_date) doc.text(`Оплатить не позднее ${ruDate(due_date)}`, L, doc.y, { width: W });
  if (note) doc.text(note, L, doc.y, { width: W });
  const signer = seller.signer || (seller.inn.length === 12 ? seller.name : '');
  signatures(doc, `Руководитель / ИП  ${signer}`, `Бухгалтер  ${seller.accountant || signer}`);
  await finish(doc, path);
}

export async function renderAct(path, { number, date, seller, buyer, totals: t, purpose, period }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Акт № ${number}`, Author: seller.name } });
  doc.lineWidth(0.6);
  doc.font(BOLD).fontSize(14).text(`Акт № ${number} от ${ruDate(date)}`, L, 40, { width: W });
  doc.moveTo(L, doc.y + 4).lineTo(L + W, doc.y + 4).lineWidth(1.5).stroke().lineWidth(0.6);
  doc.moveDown(0.8).font(FONT).fontSize(9);
  doc.text(`Исполнитель: ${partyLine(seller)}`, L, doc.y, { width: W }).moveDown(0.4);
  doc.text(`Заказчик: ${partyLine(buyer)}`, L, doc.y, { width: W }).moveDown(0.4);
  if (purpose) doc.text(`Основание: ${purpose}`, L, doc.y, { width: W });
  if (period) doc.text(`Период оказания услуг: ${period}`, L, doc.y, { width: W });
  doc.moveDown(0.6);
  table(doc, itemRows(t), ITEM_COLS, 'Наименование работ, услуг');
  totals(doc, t);
  doc.moveDown(0.8).font(FONT).fontSize(9).text(
    'Вышеперечисленные работы (услуги) выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.',
    L, doc.y, { width: W });
  signatures(doc, `ИСПОЛНИТЕЛЬ\n${seller.name}\n${seller.signer || ''}`, `ЗАКАЗЧИК\n${buyer.name}\n${buyer.signer || ''}`);
  await finish(doc, path);
}
