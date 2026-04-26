import type { ActivityEventType, ActivityKind } from "@/lib/types";

export type BalanceEntry = {
  id: string;
  sourceId: string;
  sourceType: ActivityKind;
  eventType: ActivityEventType;
  title: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyImage?: string | null;
  debtorName: string;
  creditorName: string;
  amountMinor: number;
  currencyCode: string;
  direction: "owedToYou" | "youOwe";
  date: Date;
  groupName?: string;
  link: string;
};

export type CurrencyTotal = {
  currencyCode: string;
  amountMinor: number;
};

export type CounterpartyBalance = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyImage?: string | null;
  currencyCode: string;
  netAmountMinor: number;
};

export function sumByCurrency(
  entries: Array<{ currencyCode: string; amountMinor: number }>
): CurrencyTotal[] {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    totals.set(entry.currencyCode, (totals.get(entry.currencyCode) ?? 0) + entry.amountMinor);
  }

  return Array.from(totals.entries())
    .map(([currencyCode, amountMinor]) => ({ currencyCode, amountMinor }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

export function summarizeCounterparties(entries: BalanceEntry[]) {
  const grouped = new Map<string, CounterpartyBalance>();

  for (const entry of entries) {
    const key = `${entry.counterpartyId}:${entry.currencyCode}`;
    const current = grouped.get(key);
    const signedAmount = entry.direction === "owedToYou" ? entry.amountMinor : -entry.amountMinor;

    grouped.set(key, {
      counterpartyId: entry.counterpartyId,
      counterpartyName: entry.counterpartyName,
      counterpartyImage: entry.counterpartyImage,
      currencyCode: entry.currencyCode,
      netAmountMinor: (current?.netAmountMinor ?? 0) + signedAmount
    });
  }

  return Array.from(grouped.values()).sort(
    (a, b) => Math.abs(b.netAmountMinor) - Math.abs(a.netAmountMinor)
  );
}

export function buildBalanceSummary(entries: BalanceEntry[]) {
  const owedToYou = entries.filter((entry) => entry.direction === "owedToYou");
  const youOwe = entries.filter((entry) => entry.direction === "youOwe");

  return {
    owedToYou: sumByCurrency(owedToYou),
    youOwe: sumByCurrency(youOwe),
    net: sumByCurrency([
      ...owedToYou.map((entry) => ({
        currencyCode: entry.currencyCode,
        amountMinor: entry.amountMinor
      })),
      ...youOwe.map((entry) => ({
        currencyCode: entry.currencyCode,
        amountMinor: -entry.amountMinor
      }))
    ]),
    counterparties: summarizeCounterparties(entries)
  };
}
