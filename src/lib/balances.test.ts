import { describe, expect, it } from "vitest";

import { buildBalanceSummary, type BalanceEntry } from "@/lib/balances";

const baseEntries: BalanceEntry[] = [
  {
    id: "1",
    sourceId: "expense-1",
    sourceType: "expense",
    eventType: "created",
    title: "Groceries",
    counterpartyId: "u2",
    counterpartyName: "Aida",
    debtorName: "Aida",
    creditorName: "Ramazan",
    amountMinor: 2500,
    currencyCode: "USD",
    direction: "owedToYou",
    date: new Date("2026-01-01"),
    link: "/activity/expense/expense-1"
  },
  {
    id: "2",
    sourceId: "debt-1",
    sourceType: "debt",
    eventType: "created",
    title: "Taxi",
    counterpartyId: "u3",
    counterpartyName: "Marat",
    debtorName: "Ramazan",
    creditorName: "Marat",
    amountMinor: 1200,
    currencyCode: "USD",
    direction: "youOwe",
    date: new Date("2026-01-02"),
    link: "/activity/debt/debt-1"
  },
  {
    id: "3",
    sourceId: "expense-2",
    sourceType: "expense",
    eventType: "created",
    title: "Dinner",
    counterpartyId: "u2",
    counterpartyName: "Aida",
    debtorName: "Ramazan",
    creditorName: "Aida",
    amountMinor: 500,
    currencyCode: "EUR",
    direction: "youOwe",
    date: new Date("2026-01-03"),
    link: "/activity/expense/expense-2"
  }
];

describe("buildBalanceSummary", () => {
  it("groups owed-to-you, you-owe, and net totals by currency", () => {
    const summary = buildBalanceSummary(baseEntries);

    expect(summary.owedToYou).toEqual([{ currencyCode: "USD", amountMinor: 2500 }]);
    expect(summary.youOwe).toEqual([
      { currencyCode: "EUR", amountMinor: 500 },
      { currencyCode: "USD", amountMinor: 1200 }
    ]);
    expect(summary.net).toEqual([
      { currencyCode: "EUR", amountMinor: -500 },
      { currencyCode: "USD", amountMinor: 1300 }
    ]);
  });

  it("summarizes counterparty balances per currency", () => {
    const summary = buildBalanceSummary(baseEntries);

    expect(summary.counterparties).toEqual([
      {
        counterpartyId: "u2",
        counterpartyName: "Aida",
        counterpartyImage: undefined,
        currencyCode: "USD",
        netAmountMinor: 2500
      },
      {
        counterpartyId: "u3",
        counterpartyName: "Marat",
        counterpartyImage: undefined,
        currencyCode: "USD",
        netAmountMinor: -1200
      },
      {
        counterpartyId: "u2",
        counterpartyName: "Aida",
        counterpartyImage: undefined,
        currencyCode: "EUR",
        netAmountMinor: -500
      }
    ]);
  });
});
