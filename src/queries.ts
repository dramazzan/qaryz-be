import { DirectDebtStatus, ExpenseParticipantStatus, GroupRole } from "@prisma/client";

import { buildBalanceSummary, type BalanceEntry } from "@/lib/balances";
import { getSignedReceiptUrl } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

type DisplayUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type DirectDebtWithParties = {
  id: string;
  lenderId: string | null;
  borrowerId: string | null;
  externalCounterpartyName: string | null;
  externalCounterpartyEmail: string | null;
  lender: DisplayUser | null;
  borrower: DisplayUser | null;
};

function displayUserName(user: DisplayUser | null | undefined, fallback: string) {
  return user?.name ?? user?.email ?? fallback;
}

function getExternalCounterpartyName(debt: Pick<DirectDebtWithParties, "externalCounterpartyName" | "externalCounterpartyEmail">) {
  return debt.externalCounterpartyName ?? debt.externalCounterpartyEmail ?? "Человек";
}

function getExternalCounterpartyId(debt: Pick<DirectDebtWithParties, "id" | "externalCounterpartyName" | "externalCounterpartyEmail">) {
  const value = debt.externalCounterpartyEmail ?? debt.externalCounterpartyName;
  return value ? `external:${value.trim().toLowerCase()}` : `external:${debt.id}`;
}

function getDebtCounterparty(debt: DirectDebtWithParties, userId: string) {
  const externalName = getExternalCounterpartyName(debt);

  if (debt.lenderId === userId) {
    return {
      id: debt.borrowerId ?? getExternalCounterpartyId(debt),
      name: displayUserName(debt.borrower, externalName),
      image: debt.borrower?.image ?? null
    };
  }

  return {
    id: debt.lenderId ?? getExternalCounterpartyId(debt),
    name: displayUserName(debt.lender, externalName),
    image: debt.lender?.image ?? null
  };
}

function getDebtPartyNames(debt: DirectDebtWithParties) {
  const externalName = getExternalCounterpartyName(debt);

  return {
    borrowerName: displayUserName(debt.borrower, debt.borrowerId ? "Кто-то" : externalName),
    lenderName: displayUserName(debt.lender, debt.lenderId ? "кому-то" : externalName)
  };
}

export function getFriendPair(userId: string, friendId: string) {
  return userId.localeCompare(friendId) < 0
    ? { userAId: userId, userBId: friendId }
    : { userAId: friendId, userBId: userId };
}

export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null
    }
  });
}

export async function listDashboardBalances(userId: string) {
  const [owedToYouShares, youOweShares, directDebts] = await Promise.all([
    prisma.expenseParticipant.findMany({
      where: {
        status: ExpenseParticipantStatus.OPEN,
        userId: {
          not: userId
        },
        expense: {
          payerId: userId
        }
      },
      include: {
        user: true,
        expense: {
          include: {
            group: {
              select: {
                name: true
              }
            },
            payer: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.expenseParticipant.findMany({
      where: {
        status: ExpenseParticipantStatus.OPEN,
        userId,
        expense: {
          payerId: {
            not: userId
          }
        }
      },
      include: {
        user: true,
        expense: {
          include: {
            group: {
              select: {
                name: true
              }
            },
            payer: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.directDebt.findMany({
      where: {
        status: DirectDebtStatus.OPEN,
        OR: [{ lenderId: userId }, { borrowerId: userId }]
      },
      include: {
        lender: true,
        borrower: true
      },
      orderBy: {
        createdAt: "desc"
      }
    })
  ]);

  const entries: BalanceEntry[] = [];

  for (const participant of owedToYouShares) {
    const expense = participant.expense;
    const debtorName = participant.user.name ?? participant.user.email ?? "Участник";
    const creditorName = expense.payer.name ?? expense.payer.email ?? "Участник";

    entries.push({
      id: participant.id,
      sourceId: expense.id,
      sourceType: "expense",
      eventType: "created",
      title: expense.title,
      counterpartyId: participant.userId,
      counterpartyName: debtorName,
      counterpartyImage: participant.user.image,
      debtorName,
      creditorName,
      amountMinor: participant.shareMinor,
      currencyCode: expense.currencyCode,
      direction: "owedToYou",
      date: expense.expenseDate,
      groupName: expense.group.name,
      link: `/activity/expense/${expense.id}`
    });
  }

  for (const participant of youOweShares) {
    const expense = participant.expense;
    const debtorName = participant.user.name ?? participant.user.email ?? "Участник";
    const creditorName = expense.payer.name ?? expense.payer.email ?? "Участник";

    entries.push({
      id: participant.id,
      sourceId: expense.id,
      sourceType: "expense",
      eventType: "created",
      title: expense.title,
      counterpartyId: expense.payer.id,
      counterpartyName: creditorName,
      counterpartyImage: expense.payer.image,
      debtorName,
      creditorName,
      amountMinor: participant.shareMinor,
      currencyCode: expense.currencyCode,
      direction: "youOwe",
      date: expense.expenseDate,
      groupName: expense.group.name,
      link: `/activity/expense/${expense.id}`
    });
  }

  for (const debt of directDebts) {
    const counterparty = getDebtCounterparty(debt, userId);
    const { borrowerName, lenderName } = getDebtPartyNames(debt);

    if (debt.lenderId === userId) {
      entries.push({
        id: debt.id,
        sourceId: debt.id,
        sourceType: "debt",
        eventType: "created",
        title: debt.title,
        counterpartyId: counterparty.id,
        counterpartyName: counterparty.name,
        counterpartyImage: counterparty.image,
        debtorName: borrowerName,
        creditorName: lenderName,
        amountMinor: debt.amountMinor,
        currencyCode: debt.currencyCode,
        direction: "owedToYou",
        date: debt.debtDate,
        link: `/activity/debt/${debt.id}`
      });
    }

    if (debt.borrowerId === userId) {
      entries.push({
        id: debt.id,
        sourceId: debt.id,
        sourceType: "debt",
        eventType: "created",
        title: debt.title,
        counterpartyId: counterparty.id,
        counterpartyName: counterparty.name,
        counterpartyImage: counterparty.image,
        debtorName: borrowerName,
        creditorName: lenderName,
        amountMinor: debt.amountMinor,
        currencyCode: debt.currencyCode,
        direction: "youOwe",
        date: debt.debtDate,
        link: `/activity/debt/${debt.id}`
      });
    }
  }

  return {
    entries: entries.sort((a, b) => b.date.getTime() - a.date.getTime()),
    summary: buildBalanceSummary(entries)
  };
}

export async function getDashboardData(userId: string) {
  const [balances, groupMemberships] = await Promise.all([
    listDashboardBalances(userId),
    prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: true
      },
      orderBy: {
        createdAt: "asc"
      }
    })
  ]);

  return {
    groups: groupMemberships.map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
      currencyCode: membership.group.currencyCode,
      role: membership.role
    })),
    ...balances
  };
}

export async function getGroupsData(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          invite: true,
          expenses: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1
          },
          _count: {
            select: {
              members: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return memberships.map((membership) => ({
    id: membership.group.id,
    name: membership.group.name,
    currencyCode: membership.group.currencyCode,
    role: membership.role,
    memberCount: membership.group._count.members,
    inviteCode: membership.group.invite?.code ?? null,
    lastExpenseAt: membership.group.expenses[0]?.createdAt ?? null
  }));
}

export async function getGroupDetailData(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId
      }
    }
  });

  if (!membership) {
    return null;
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      invite: true,
      members: {
        include: {
          user: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      expenses: {
        include: {
          payer: true,
          participants: {
            include: {
              user: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 10
      },
      _count: {
        select: {
          expenses: true
        }
      }
    }
  });

  if (!group) {
    return null;
  }

  return {
    id: group.id,
    name: group.name,
    currencyCode: group.currencyCode,
    viewerRole: membership.role,
    inviteCode: group.invite?.code ?? null,
    hasExpenses: group._count.expenses > 0,
    members: group.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: member.user.name ?? member.user.email ?? "Участник",
      email: member.user.email ?? "",
      image: member.user.image
    })),
    expenses: group.expenses
  };
}

export async function getFriendsData(userId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }]
    },
    include: {
      userA: true,
      userB: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return friendships.map((friendship) => {
    const friend = friendship.userAId === userId ? friendship.userB : friendship.userA;

    return {
      id: friend.id,
      name: friend.name ?? friend.email ?? "Пользователь",
      email: friend.email ?? "",
      image: friend.image,
      createdAt: friendship.createdAt
    };
  });
}

export async function getPlatformUsersData(userId: string) {
  const [users, friendships] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: {
          not: userId
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true
      }
    }),
    prisma.friendship.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }]
      },
      select: {
        userAId: true,
        userBId: true,
        createdAt: true
      }
    })
  ]);

  const friendshipDates = new Map<string, Date>();

  for (const friendship of friendships) {
    const friendId = friendship.userAId === userId ? friendship.userBId : friendship.userAId;
    friendshipDates.set(friendId, friendship.createdAt);
  }

  return users
    .map((platformUser) => ({
      id: platformUser.id,
      name: platformUser.name ?? platformUser.email ?? "Пользователь",
      email: platformUser.email ?? "",
      image: platformUser.image,
      createdAt: platformUser.createdAt,
      isFriend: friendshipDates.has(platformUser.id),
      friendshipCreatedAt: friendshipDates.get(platformUser.id) ?? null
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getRecentContacts(userId: string) {
  const [memberships, debts, friends] = await Promise.all([
    prisma.groupMember.findMany({
      where: { userId },
      select: {
        groupId: true
      }
    }),
    prisma.directDebt.findMany({
      where: {
        OR: [{ lenderId: userId }, { borrowerId: userId }]
      },
      include: {
        lender: true,
        borrower: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 10
    }),
    getFriendsData(userId)
  ]);

  const groupIds = memberships.map((membership) => membership.groupId);
  const memberRecords = groupIds.length
    ? await prisma.groupMember.findMany({
        where: {
          groupId: {
            in: groupIds
          },
          userId: {
            not: userId
          }
        },
        include: {
          user: true
        }
      })
    : [];

  const contacts = new Map<
    string,
    { id: string; name: string; email: string; image?: string | null }
  >();

  for (const friend of friends) {
    contacts.set(friend.id, {
      id: friend.id,
      name: friend.name,
      email: friend.email,
      image: friend.image
    });
  }

  for (const member of memberRecords) {
    contacts.set(member.userId, {
      id: member.userId,
      name: member.user.name ?? member.user.email ?? "Участник",
      email: member.user.email ?? "",
      image: member.user.image
    });
  }

  for (const debt of debts) {
    const counterparty = debt.lenderId === userId ? debt.borrower : debt.lender;

    if (!counterparty) {
      continue;
    }

    contacts.set(counterparty.id, {
      id: counterparty.id,
      name: counterparty.name ?? counterparty.email ?? "Человек",
      email: counterparty.email ?? "",
      image: counterparty.image
    });
  }

  return Array.from(contacts.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAddPageData(userId: string) {
  const [groupMemberships, recentContacts] = await Promise.all([
    prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    getRecentContacts(userId)
  ]);

  return {
    groups: groupMemberships.map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
      currencyCode: membership.group.currencyCode,
      members: membership.group.members.map((member) => ({
        id: member.userId,
        name: member.user.name ?? member.user.email ?? "Участник",
        image: member.user.image
      }))
    })),
    recentContacts
  };
}

export async function listHistory(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      historyClearedAt: true
    }
  });
  const historyClearedAt = user?.historyClearedAt ?? null;
  const createdAfterClear = historyClearedAt ? { gt: historyClearedAt } : undefined;

  const [expenses, settledShares, directDebts] = await Promise.all([
    prisma.expense.findMany({
      where: {
        ...(createdAfterClear ? { createdAt: createdAfterClear } : {}),
        OR: [{ payerId: userId }, { participants: { some: { userId } } }]
      },
      include: {
        group: {
          select: {
            name: true
          }
        },
        payer: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    prisma.expenseParticipant.findMany({
      where: {
        settledAt: historyClearedAt ? { gt: historyClearedAt } : { not: null },
        OR: [
          { userId },
          {
            expense: {
              payerId: userId
            }
          }
        ]
      },
      include: {
        user: true,
        expense: {
          include: {
            group: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        settledAt: "desc"
      },
      take: 80
    }),
    prisma.directDebt.findMany({
      where: {
        AND: [
          {
            OR: [{ lenderId: userId }, { borrowerId: userId }]
          },
          historyClearedAt
            ? {
                OR: [
                  { createdAt: { gt: historyClearedAt } },
                  { updatedAt: { gt: historyClearedAt } },
                  { settledAt: { gt: historyClearedAt } }
                ]
              }
            : {}
        ]
      },
      include: {
        lender: true,
        borrower: true,
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 100
    })
  ]);

  const events: Array<{
    id: string;
    kind: "expense" | "debt";
    eventType: "created" | "updated" | "settled";
    title: string;
    subtitle: string;
    date: Date;
    link: string;
    amountMinor: number;
    currencyCode: string;
  }> = [];

  for (const expense of expenses) {
    events.push({
      id: expense.id,
      kind: "expense",
      eventType: "created",
      title: expense.title,
      subtitle: `${expense.group.name} · оплатил ${expense.payer.name ?? expense.payer.email ?? "Участник"}`,
      date: expense.createdAt,
      link: `/activity/expense/${expense.id}`,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode
    });

  }

  for (const participant of settledShares) {
    if (!participant.settledAt || participant.userId === participant.expense.payerId) {
      continue;
    }

    events.push({
      id: `${participant.expenseId}:${participant.id}:settled`,
      kind: "expense",
      eventType: "settled",
      title: `${participant.user.name ?? participant.user.email ?? "Участник"} погасил(а) ${participant.expense.title}`,
      subtitle: participant.expense.group.name,
      date: participant.settledAt,
      link: `/activity/expense/${participant.expenseId}`,
      amountMinor: participant.shareMinor,
      currencyCode: participant.expense.currencyCode
    });
  }

  for (const debt of directDebts) {
    const { borrowerName, lenderName } = getDebtPartyNames(debt);
    const partyText = `${borrowerName} должен(на) ${lenderName}`;

    if (!historyClearedAt || debt.createdAt > historyClearedAt) {
      events.push({
        id: debt.id,
        kind: "debt",
        eventType: "created",
        title: debt.title,
        subtitle: partyText,
        date: debt.createdAt,
        link: `/activity/debt/${debt.id}`,
        amountMinor: debt.amountMinor,
        currencyCode: debt.currencyCode
      });
    }

    if (
      debt.updatedAt.getTime() > debt.createdAt.getTime() &&
      debt.status === DirectDebtStatus.OPEN &&
      (!historyClearedAt || debt.updatedAt > historyClearedAt)
    ) {
      events.push({
        id: `${debt.id}:updated`,
        kind: "debt",
        eventType: "updated",
        title: `${debt.title} обновлён`,
        subtitle: partyText,
        date: debt.updatedAt,
        link: `/activity/debt/${debt.id}`,
        amountMinor: debt.amountMinor,
        currencyCode: debt.currencyCode
      });
    }

    if (debt.settledAt && (!historyClearedAt || debt.settledAt > historyClearedAt)) {
      events.push({
        id: `${debt.id}:settled`,
        kind: "debt",
        eventType: "settled",
        title: `${debt.title} погашен`,
        subtitle: partyText,
        date: debt.settledAt,
        link: `/activity/debt/${debt.id}`,
        amountMinor: debt.amountMinor,
        currencyCode: debt.currencyCode
      });
    }
  }

  return events.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function getExpenseDetail(userId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      group: {
        members: {
          some: {
            userId
          }
        }
      }
    },
    include: {
      group: true,
      payer: true,
      participants: {
        include: {
          user: true
        }
      }
    }
  });

  if (!expense) {
    return null;
  }

  const receiptUrl = expense.receiptPath
    ? await getSignedReceiptUrl(expense.receiptPath).catch(() => null)
    : null;

  return {
    ...expense,
    receiptUrl
  };
}

export async function getDirectDebtDetail(userId: string, debtId: string) {
  return prisma.directDebt.findFirst({
    where: {
      id: debtId,
      OR: [{ lenderId: userId }, { borrowerId: userId }]
    },
    include: {
      lender: true,
      borrower: true
    }
  });
}

export async function getProfileData(userId: string) {
  const [user, notifications, memberships, unreadCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId }
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: {
        createdAt: "desc"
      },
      take: 25
    }),
    prisma.groupMember.findMany({
      where: { userId },
      select: {
        id: true
      }
    }),
    getUnreadNotificationCount(userId)
  ]);

  return {
    user,
    notifications,
    memberships,
    unreadCount
  };
}

export function canManageGroup(role: GroupRole) {
  return role === GroupRole.OWNER || role === GroupRole.ADMIN;
}
