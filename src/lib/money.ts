const MINOR_UNITS = 100;

export function parseMoneyToMinorUnits(raw: string) {
  const normalized = raw.trim().replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Введите корректную сумму");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const whole = Number.parseInt(wholePart, 10) * MINOR_UNITS;
  const fractional = Number.parseInt(fractionalPart.padEnd(2, "0"), 10) || 0;
  const amount = whole + fractional;

  if (amount <= 0) {
    throw new Error("Сумма должна быть больше нуля");
  }

  return amount;
}

export function formatMinorUnits(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2
  }).format(amountMinor / MINOR_UNITS);
}

export function formatSignedMinorUnits(amountMinor: number, currencyCode: string) {
  const prefix = amountMinor > 0 ? "+" : amountMinor < 0 ? "-" : "";
  return `${prefix}${formatMinorUnits(Math.abs(amountMinor), currencyCode)}`;
}
