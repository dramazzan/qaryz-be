import { describe, expect, it } from "vitest";

import { splitExpenseAmount } from "@/lib/split";

describe("splitExpenseAmount", () => {
  it("splits equally when the amount divides cleanly", () => {
    expect(
      splitExpenseAmount({
        amountMinor: 1200,
        payerId: "a",
        participantIds: ["a", "b", "c"]
      })
    ).toEqual([
      { userId: "a", shareMinor: 400 },
      { userId: "b", shareMinor: 400 },
      { userId: "c", shareMinor: 400 }
    ]);
  });

  it("assigns the remainder to the payer when the payer participates", () => {
    expect(
      splitExpenseAmount({
        amountMinor: 1000,
        payerId: "a",
        participantIds: ["a", "b", "c"]
      })
    ).toEqual([
      { userId: "a", shareMinor: 334 },
      { userId: "b", shareMinor: 333 },
      { userId: "c", shareMinor: 333 }
    ]);
  });

  it("assigns the remainder to the first participant when the payer is excluded", () => {
    expect(
      splitExpenseAmount({
        amountMinor: 1000,
        payerId: "a",
        participantIds: ["b", "c", "d"]
      })
    ).toEqual([
      { userId: "b", shareMinor: 334 },
      { userId: "c", shareMinor: 333 },
      { userId: "d", shareMinor: 333 }
    ]);
  });
});

