type SplitInput = {
  amountMinor: number;
  payerId: string;
  participantIds: string[];
};

export type SplitResult = {
  userId: string;
  shareMinor: number;
};

export function splitExpenseAmount({
  amountMinor,
  payerId,
  participantIds
}: SplitInput): SplitResult[] {
  if (!participantIds.length) {
    throw new Error("Выберите хотя бы одного участника");
  }

  const baseShare = Math.floor(amountMinor / participantIds.length);
  let remainder = amountMinor % participantIds.length;

  return participantIds.map((userId, index) => {
    let shareMinor = baseShare;

    if (remainder > 0) {
      const shouldReceiveRemainder =
        userId === payerId || (!participantIds.includes(payerId) && index === 0);

      if (shouldReceiveRemainder) {
        shareMinor += remainder;
        remainder = 0;
      }
    }

    return {
      userId,
      shareMinor
    };
  });
}
