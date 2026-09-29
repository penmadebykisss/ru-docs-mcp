// Модель счёта и акта: проверка реквизитов, расчёт строк и НДС, платёжная строка QR по ГОСТ Р 56042-2014.

import { amountInWords, formatMoney } from './words.js';

const inn = s => /^\d{10}$|^\d{12}$/.test(s);
const round2 = x => Math.round(x * 100) / 100;

function checkInn(v) {
  const d = [...v].map(Number);
  const cs = w => w.reduce((s, k, i) => s + k * d[i], 0) % 11 % 10;
  if (d.length === 10) return cs([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return cs([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && cs([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

function checkAccount(bik, account) {
  const d = [...(bik.slice(-3) + account)].map(Number);
  return d.reduce((s, x, i) => s + x * [7, 1, 3][i % 3], 0) % 10 === 0;
}

/** Проверяет реквизиты стороны; возвращает список проблем (пустой — всё в порядке). */
export function validateParty(p, role, { needBank }) {
  const errs = [];
  if (!p?.name) errs.push(`${role}: не указано название`);
  if (!p?.inn || !inn(p.inn)) errs.push(`${role}: ИНН должен состоять из 10 или 12 цифр`);
  else if (!checkInn(p.inn)) errs.push(`${role}: неверная контрольная сумма ИНН ${p.inn}`);
  if (p?.kpp && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(p.kpp)) errs.push(`${role}: КПП — 9 символов`);
  if (needBank) {
    if (!/^04\d{7}$/.test(p?.bik || '')) errs.push(`${role}: БИК — 9 цифр, начинается с 04`);
    if (!/^\d{20}$/.test(p?.account || '')) errs.push(`${role}: расчётный счёт — 20 цифр`);
    else if (/^04\d{7}$/.test(p?.bik || '') && !checkAccount(p.bik, p.account)) errs.push(`${role}: расчётный счёт не соответствует БИК`);
    if (!p?.bank_name) errs.push(`${role}: не указан банк`);
    if (p?.correspondent_account && !/^\d{20}$/.test(p.correspondent_account)) errs.push(`${role}: корсчёт — 20 цифр`);
  }
  return errs;
}

/**
 * Считает строки и итоги. vat: 'none' (без НДС), либо ставка 0/5/7/10/20/22;
 * vat_included — цены уже с НДС (по умолчанию да, как чаще выставляют).
 */
export function computeTotals(items, vat = 'none', vatIncluded = true) {
  if (!items?.length) throw new Error('Нужна хотя бы одна позиция');
  const rows = items.map((it, i) => {
    const qty = it.quantity ?? 1;
    if (!(qty > 0)) throw new Error(`Позиция ${i + 1}: количество должно быть больше нуля`);
    if (!(it.price >= 0)) throw new Error(`Позиция ${i + 1}: цена не может быть отрицательной`);
    return { n: i + 1, name: it.name, quantity: qty, unit: it.unit || 'шт', price: round2(it.price), sum: round2(qty * it.price) };
  });
  const sum = round2(rows.reduce((s, r) => s + r.sum, 0));
  let vatAmount = 0, total = sum;
  if (vat !== 'none') {
    const rate = Number(vat);
    if (vatIncluded) vatAmount = round2(sum * rate / (100 + rate));
    else { vatAmount = round2(sum * rate / 100); total = round2(sum + vatAmount); }
  }
  return {
    rows, sum, vat, vat_included: vatIncluded, vat_amount: vatAmount, total,
    vat_label: vat === 'none' ? 'Без НДС' : `В том числе НДС ${vat}%`,
    total_words: amountInWords(total),
    total_text: formatMoney(total),
  };
}

const clean = s => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** Строка для QR-кода оплаты (ГОСТ Р 56042-2014, UTF-8): читается приложениями всех крупных банков РФ. */
export function paymentQrPayload(seller, total, purpose) {
  const f = [
    'ST00012',
    `Name=${clean(seller.name)}`,
    `PersonalAcc=${seller.account}`,
    `BankName=${clean(seller.bank_name)}`,
    `BIC=${seller.bik}`,
    `CorrespAcc=${seller.correspondent_account || '0'}`,
    `PayeeINN=${seller.inn}`,
    ...(seller.kpp ? [`KPP=${seller.kpp}`] : []),
    `Sum=${Math.round(total * 100)}`,
    `Purpose=${clean(purpose).slice(0, 210)}`,
  ];
  return f.join('|');
}

export function ruDate(iso) {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y} г.`;
}
