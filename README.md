# ru-docs-mcp — счета, акты и QR-оплата для ИИ-агентов

[![penmadebykisss/ru-docs-mcp MCP server](https://glama.ai/mcp/servers/penmadebykisss/ru-docs-mcp/badges/score.svg)](https://glama.ai/mcp/servers/penmadebykisss/ru-docs-mcp)
[![CI](https://github.com/penmadebykisss/ru-docs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/penmadebykisss/ru-docs-mcp/actions/workflows/ci.yml)

MCP-сервер, который позволяет Claude, Cursor и другим ИИ-ассистентам **выставлять документы российского бизнеса в PDF**:
счёт на оплату с **QR-кодом для оплаты из банковского приложения**, акт выполненных работ, отдельный платёжный QR и сумму прописью.
Реквизиты проверяются по контрольным суммам (ИНН, КПП, БИК, ключ расчётного счёта) до создания файла.
Работает полностью локально: без регистрации, токенов и отправки данных куда-либо.

Скажите ассистенту:
- *«Выстави счёт ООО „Ромашка“ на разработку лендинга 45 000 ₽ и 12 часов поддержки по 1500, без НДС, оплата до 6 октября»*
- *«Сделай акт за сентябрь по тем же позициям»*
- *«Дай QR для оплаты 1500 ₽ за консультацию, скину клиенту в Telegram»*
- *«Напиши 1 234 567,89 прописью»*

Вместе с [ru-business-mcp](https://github.com/penmadebykisss/ru-business-mcp) ассистент сам подтянет реквизиты покупателя по ИНН
и банка по БИК.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `invoice_create` | Счёт на оплату в PDF по типовой форме: банковский блок, позиции, НДС или «Без НДС», сумма прописью, подписи, QR-код оплаты |
| `act_create` | Акт выполненных работ (оказанных услуг) в PDF с подписями сторон |
| `payment_qr` | QR-код оплаты по ГОСТ Р 56042 (PNG) — открывается в приложениях Сбербанка, Т-Банка, ВТБ, Альфы и других |
| `amount_in_words` | Сумма прописью: RUB, USD, EUR, CNY или просто число |

НДС: без НДС (УСН, самозанятые, патент) или ставки 0, 5, 7, 10, 20, 22 % — «в том числе» или сверху.

## Установка

Нужен [Node.js](https://nodejs.org) 18+.

### Claude Desktop

```json
{
  "mcpServers": {
    "ru-docs": {
      "command": "npx",
      "args": ["-y", "github:penmadebykisss/ru-docs-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add ru-docs -- npx -y github:penmadebykisss/ru-docs-mcp
```

PDF сохраняются в `~/Documents/ru-docs` (или в папку из переменной `RU_DOCS_DIR`), путь приходит в ответе; файл также
передаётся клиенту целиком.

## Проверка

```bash
npm test   # создаёт настоящие PDF и PNG во временной папке
```

## Нужна настройка или доработка?

Подключу этот сервер под ключ: установка, настройка под ваши данные и процессы, доработка под нестандартные поля,
ежедневные сводки. Пишите в Telegram **[@penmadebykisss](https://t.me/penmadebykisss)** или оставьте заявку на
[penmadebykisss.github.io](https://penmadebykisss.github.io).

*Need help setting this up or a custom MCP server? Telegram [@penmadebykisss](https://t.me/penmadebykisss).*

## English

**ru-docs-mcp** lets AI assistants issue Russian business paperwork as PDF: invoices (счёт на оплату) with a bank payment QR code
(GOST R 56042, scanned by any Russian banking app), acts of completed work, standalone payment QR codes and amounts in words.
Requisites (INN, KPP, BIK, account key) are checksum-validated before a file is produced. Fully local, no API keys.

```bash
npx -y github:penmadebykisss/ru-docs-mcp
```

## Лицензия

MIT. Шрифт DejaVu Sans — свободная лицензия Bitstream Vera / Public Domain.
