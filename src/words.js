// Сумма прописью по правилам русского языка (для счетов, актов, договоров).

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

// [одна, две-четыре, пять+], род
const SCALES = [
  null,
  [['тысяча', 'тысячи', 'тысяч'], 'f'],
  [['миллион', 'миллиона', 'миллионов'], 'm'],
  [['миллиард', 'миллиарда', 'миллиардов'], 'm'],
  [['триллион', 'триллиона', 'триллионов'], 'm'],
];

export function plural(n, [one, few, many]) {
  const n10 = n % 10, n100 = n % 100;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

function triad(n, gender) {
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((gender === 'f' ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** Целое число прописью; gender — род единиц ('m' — рубль, 'f' — копейка/штука). */
export function numberToWords(n, gender = 'm') {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Нужно целое неотрицательное число');
  if (n === 0) return 'ноль';
  const words = [];
  const groups = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  if (groups.length > SCALES.length) throw new Error('Слишком большое число');
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const [forms, scaleGender] = SCALES[i] || [null, gender];
    words.push(...triad(g, i === 0 ? gender : scaleGender));
    if (forms) words.push(plural(g, forms));
  }
  return words.join(' ');
}

const CURRENCIES = {
  RUB: { major: ['рубль', 'рубля', 'рублей'], mg: 'm', minor: ['копейка', 'копейки', 'копеек'], ng: 'f' },
  USD: { major: ['доллар США', 'доллара США', 'долларов США'], mg: 'm', minor: ['цент', 'цента', 'центов'], ng: 'm' },
  EUR: { major: ['евро', 'евро', 'евро'], mg: 'm', minor: ['евроцент', 'евроцента', 'евроцентов'], ng: 'm' },
  CNY: { major: ['юань', 'юаня', 'юаней'], mg: 'm', minor: ['фэнь', 'фэня', 'фэней'], ng: 'm' },
};

/** «Сто двадцать три рубля 45 копеек» — как пишут в счетах и актах. */
export function amountInWords(amount, currency = 'RUB', { minorInWords = false } = {}) {
  const c = CURRENCIES[currency];
  if (!c) throw new Error(`Валюта ${currency} не поддерживается: ${Object.keys(CURRENCIES).join(', ')}`);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Сумма должна быть неотрицательным числом');
  const cents = Math.round(amount * 100);
  const major = Math.floor(cents / 100), minor = cents % 100;
  const majorText = `${numberToWords(major, c.mg)} ${plural(major, c.major)}`;
  const minorText = minorInWords ? `${numberToWords(minor, c.ng)} ${plural(minor, c.minor)}` : `${String(minor).padStart(2, '0')} ${plural(minor, c.minor)}`;
  const text = `${majorText} ${minorText}`;
  return text[0].toUpperCase() + text.slice(1);
}

/** 1234567.8 → «1 234 567,80» */
export function formatMoney(x) {
  const [i, f] = (Math.round(x * 100) / 100).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + f;
}
