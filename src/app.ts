import cors from "cors";
import { DirectDebtStatus, GroupRole, NotificationType } from "@prisma/client";
import express, { type Request } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";

import {
  getAuthenticatedUser,
  getCurrentUser,
  handleGoogleCallback,
  handleSessionExchange,
  logout,
  redirectToGoogle,
  requireAuth
} from "@/backend/auth";
import { errorHandler, HttpError } from "@/backend/errors";
import {
  getAddPageData,
  getDashboardData,
  getDirectDebtDetail,
  getExpenseDetail,
  getFriendPair,
  getFriendsData,
  getGroupDetailData,
  getGroupsData,
  getPlatformUsersData,
  getProfileData,
  getRecentContacts,
  getUnreadNotificationCount,
  listDashboardBalances,
  listHistory,
  canManageGroup
} from "@/backend/queries";
import { sendPendingEmails } from "@/lib/email";
import { parseMoneyToMinorUnits } from "@/lib/money";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { splitExpenseAmount } from "@/lib/split";
import { uploadReceipt } from "@/lib/supabase";
import { createInviteCode } from "@/lib/utils";
import {
  createDirectDebtSchema,
  createExpenseSchema,
  createGroupSchema,
  addFriendSchema,
  groupSettingsSchema,
  joinGroupSchema,
  removeMemberSchema,
  settleDirectDebtSchema,
  settleExpenseSchema,
  updateDirectDebtSchema,
  updateMemberRoleSchema
} from "@/lib/validation";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_RECEIPT_BYTES
  }
});

type BodyRecord = Record<string, unknown>;

function getAllowedOrigins() {
  return (process.env.FRONTEND_ORIGIN ?? "https://qaryz-fe.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getBodyValue(body: BodyRecord, key: string) {
  const value = body[key];

  if (Array.isArray(value)) {
    return value[0] === undefined ? "" : String(value[0]);
  }

  return value === undefined || value === null ? "" : String(value);
}

function getOptionalBodyValue(body: BodyRecord, key: string) {
  const value = getBodyValue(body, key).trim();
  return value ? value : undefined;
}

function getBodyValues(body: BodyRecord, key: string) {
  const value = body[key];

  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  return value === undefined || value === null || value === "" ? [] : [String(value)];
}

function getDirectDebtUserIds(...userIds: Array<string | null | undefined>) {
  return userIds.filter((userId): userId is string => Boolean(userId));
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createInviteCode();
    const existing = await prisma.groupInvite.findUnique({
      where: { code }
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Не удалось создать уникальный код приглашения");
}

async function requireGroupManager(groupId: string, userId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId
      }
    }
  });

  if (!membership || !canManageGroup(membership.role)) {
    throw new HttpError(403, "У вас нет прав для управления этой группой");
  }

  return membership;
}

function assertCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return;
  }

  const authorization = request.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const queryToken = typeof request.query.secret === "string" ? request.query.secret : undefined;

  if ((bearerToken ?? queryToken) !== secret) {
    throw new HttpError(401, "Недействительный cron secret");
  }
}

export function createBackendApp() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new HttpError(403, "Origin is not allowed by CORS"));
      }
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "qaryz-express-api"
    });
  });

  app.get("/health/db", async (_request, response) => {
    await prisma.$runCommandRaw({ ping: 1 });
    response.json({
      ok: true,
      database: "reachable"
    });
  });

  app.all("/api/cron/notifications", async (request, response) => {
    assertCronAuthorized(request);

    const processed = await sendPendingEmails();

    response.json({
      ok: true,
      processed
    });
  });

  app.get("/auth/google", redirectToGoogle);
  app.get("/auth/google/callback", handleGoogleCallback);
  app.post("/auth/session/exchange", handleSessionExchange);
  app.get("/auth/me", requireAuth, getCurrentUser);
  app.post("/auth/logout", logout);

  app.use("/api", requireAuth);

  app.get("/api/notifications/unread-count", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getUnreadNotificationCount(user.id));
  });

  app.get("/api/dashboard/balances", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await listDashboardBalances(user.id));
  });

  app.get("/api/dashboard", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getDashboardData(user.id));
  });

  app.get("/api/groups", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getGroupsData(user.id));
  });

  app.get("/api/friends", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getFriendsData(user.id));
  });

  app.get("/api/users", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getPlatformUsersData(user.id));
  });

  app.post("/api/friends", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = addFriendSchema.parse({
      email: getOptionalBodyValue(request.body, "email"),
      userId: getOptionalBodyValue(request.body, "userId")
    });

    const friend = parsed.userId
      ? await prisma.user.findUnique({
          where: {
            id: parsed.userId
          }
        })
      : await prisma.user.findFirst({
          where: {
            email: {
              equals: parsed.email!,
              mode: "insensitive"
            }
          }
        }
      );

    if (!friend) {
      throw new HttpError(404, "Пользователь не найден");
    }

    if (friend.id === user.id) {
      throw new HttpError(400, "Нельзя добавить себя в друзья");
    }

    const pair = getFriendPair(user.id, friend.id);
    const existing = await prisma.friendship.findUnique({
      where: {
        userAId_userBId: pair
      }
    });

    if (!existing) {
      await prisma.friendship.create({
        data: {
          ...pair,
          createdById: user.id
        }
      });
    }

    response.status(existing ? 200 : 201).json({
      id: friend.id,
      name: friend.name ?? friend.email ?? "Пользователь",
      email: friend.email ?? "",
      image: friend.image
    });
  });

  app.get("/api/groups/:groupId", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getGroupDetailData(user.id, request.params.groupId));
  });

  app.get("/api/contacts/recent", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getRecentContacts(user.id));
  });

  app.get("/api/add", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getAddPageData(user.id));
  });

  app.get("/api/history", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await listHistory(user.id));
  });

  app.post("/api/history/clear", async (request, response) => {
    const user = getAuthenticatedUser(request);

    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        historyClearedAt: new Date()
      }
    });

    response.json({
      ok: true
    });
  });

  app.get("/api/activity/expenses/:expenseId", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getExpenseDetail(user.id, request.params.expenseId));
  });

  app.get("/api/activity/debts/:debtId", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getDirectDebtDetail(user.id, request.params.debtId));
  });

  app.get("/api/profile", async (request, response) => {
    const user = getAuthenticatedUser(request);
    response.json(await getProfileData(user.id));
  });

  app.post("/api/groups", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = createGroupSchema.parse({
      name: getBodyValue(request.body, "name"),
      currencyCode: getBodyValue(request.body, "currencyCode").toUpperCase()
    });
    const inviteCode = await createUniqueInviteCode();

    const group = await prisma.group.create({
      data: {
        name: parsed.name,
        currencyCode: parsed.currencyCode,
        createdById: user.id,
        members: {
          create: {
            userId: user.id,
            role: GroupRole.OWNER
          }
        },
        invite: {
          create: {
            code: inviteCode,
            createdById: user.id
          }
        }
      }
    });

    response.status(201).json({
      id: group.id
    });
  });

  app.post("/api/groups/join", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = joinGroupSchema.parse({
      inviteCode: getBodyValue(request.body, "inviteCode").toUpperCase()
    });

    const invite = await prisma.groupInvite.findUnique({
      where: { code: parsed.inviteCode },
      include: {
        group: {
          include: {
            members: true
          }
        }
      }
    });

    if (!invite) {
      throw new HttpError(404, "Код приглашения недействителен");
    }

    const existingMembership = invite.group.members.find((member) => member.userId === user.id);

    if (!existingMembership) {
      await prisma.groupMember.create({
        data: {
          groupId: invite.groupId,
          userId: user.id,
          role: GroupRole.MEMBER
        }
      });

      const managerIds = invite.group.members
        .filter((member) => member.role !== GroupRole.MEMBER)
        .map((member) => member.userId);

      await createNotifications({
        userIds: managerIds,
        type: NotificationType.GROUP_JOINED,
        title: `${user.name ?? user.email ?? "Участник"} присоединился(ась) к ${invite.group.name}`,
        message: `${user.name ?? user.email ?? "Участник"} вошёл(ла) по коду приглашения.`,
        link: `/groups/${invite.groupId}`,
        subject: "В вашу группу вошёл новый участник",
        body: `${user.name ?? user.email ?? "Участник"} присоединился(ась) к группе ${invite.group.name}.`
      });
    }

    response.json({
      groupId: invite.groupId
    });
  });

  app.post("/api/groups/:groupId/invite/rotate", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const groupId = request.params.groupId;

    await requireGroupManager(groupId, user.id);

    const code = await createUniqueInviteCode();

    await prisma.groupInvite.upsert({
      where: {
        groupId
      },
      create: {
        groupId,
        code,
        createdById: user.id
      },
      update: {
        code,
        createdById: user.id
      }
    });

    response.json({
      code
    });
  });

  app.patch("/api/groups/:groupId/settings", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = groupSettingsSchema.parse({
      groupId: request.params.groupId,
      name: getBodyValue(request.body, "name"),
      currencyCode: getBodyValue(request.body, "currencyCode").toUpperCase()
    });

    await requireGroupManager(parsed.groupId, user.id);

    const existing = await prisma.group.findUnique({
      where: { id: parsed.groupId },
      include: {
        _count: {
          select: {
            expenses: true
          }
        }
      }
    });

    if (!existing) {
      throw new HttpError(404, "Группа не найдена");
    }

    if (existing._count.expenses > 0 && existing.currencyCode !== parsed.currencyCode) {
      throw new HttpError(400, "После первого расхода валюту менять нельзя");
    }

    await prisma.group.update({
      where: { id: parsed.groupId },
      data: {
        name: parsed.name,
        currencyCode: parsed.currencyCode
      }
    });

    response.json({
      ok: true
    });
  });

  app.patch("/api/groups/:groupId/members/:memberId/role", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = updateMemberRoleSchema.parse({
      groupId: request.params.groupId,
      memberId: request.params.memberId,
      role: getBodyValue(request.body, "role")
    });

    const actorMembership = await requireGroupManager(parsed.groupId, user.id);
    const member = await prisma.groupMember.findUnique({
      where: { id: parsed.memberId },
      include: {
        user: true
      }
    });

    if (!member || member.groupId !== parsed.groupId) {
      throw new HttpError(404, "Участник не найден");
    }

    if (member.role === GroupRole.OWNER) {
      throw new HttpError(400, "Роль владельца здесь менять нельзя");
    }

    if (actorMembership.role === GroupRole.ADMIN && member.role === GroupRole.ADMIN) {
      throw new HttpError(403, "Админ не может менять роль другого админа");
    }

    await prisma.groupMember.update({
      where: { id: parsed.memberId },
      data: {
        role: parsed.role as GroupRole
      }
    });

    response.json({
      ok: true
    });
  });

  app.delete("/api/groups/:groupId/members/:memberId", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = removeMemberSchema.parse({
      groupId: request.params.groupId,
      memberId: request.params.memberId
    });

    const actorMembership = await requireGroupManager(parsed.groupId, user.id);
    const member = await prisma.groupMember.findUnique({
      where: { id: parsed.memberId }
    });

    if (!member || member.groupId !== parsed.groupId) {
      throw new HttpError(404, "Участник не найден");
    }

    if (member.role === GroupRole.OWNER) {
      throw new HttpError(400, "Владельца нельзя удалить");
    }

    if (actorMembership.role === GroupRole.ADMIN && member.role === GroupRole.ADMIN) {
      throw new HttpError(403, "Админ не может удалить другого админа");
    }

    await prisma.groupMember.delete({
      where: { id: parsed.memberId }
    });

    response.json({
      ok: true
    });
  });

  app.post("/api/expenses", upload.single("receipt"), async (request, response) => {
    const user = getAuthenticatedUser(request);
    const body = request.body as BodyRecord;
    const participantIds = getBodyValues(body, "participantIds");
    const parsed = createExpenseSchema.parse({
      groupId: getBodyValue(body, "groupId"),
      title: getBodyValue(body, "title"),
      amount: getBodyValue(body, "amount"),
      expenseDate: getBodyValue(body, "expenseDate"),
      note: getOptionalBodyValue(body, "note"),
      participantIds
    });
    const amountMinor = parseMoneyToMinorUnits(parsed.amount);

    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: parsed.groupId,
          userId: user.id
        }
      },
      include: {
        group: {
          include: {
            members: true
          }
        }
      }
    });

    if (!membership) {
      throw new HttpError(403, "Вы не состоите в этой группе");
    }

    const uniqueParticipants = [...new Set(parsed.participantIds)];
    const groupMemberIds = new Set(membership.group.members.map((member) => member.userId));

    if (!uniqueParticipants.every((participantId) => groupMemberIds.has(participantId))) {
      throw new HttpError(400, "Все участники должны состоять в выбранной группе");
    }

    let receiptPath: string | undefined;

    if (request.file && request.file.size > 0) {
      if (!ALLOWED_RECEIPT_TYPES.includes(request.file.mimetype)) {
        throw new HttpError(400, "Чек должен быть в формате JPG, PNG, WEBP или HEIC");
      }

      const extension = request.file.originalname.split(".").pop() ?? "jpg";
      receiptPath = `${parsed.groupId}/${randomUUID()}.${extension}`;
      await uploadReceipt(request.file.buffer, receiptPath, request.file.mimetype);
    }

    const shares = splitExpenseAmount({
      amountMinor,
      payerId: user.id,
      participantIds: uniqueParticipants
    });

    const expense = await prisma.expense.create({
      data: {
        groupId: parsed.groupId,
        payerId: user.id,
        title: parsed.title,
        note: parsed.note || null,
        amountMinor,
        currencyCode: membership.group.currencyCode,
        expenseDate: new Date(parsed.expenseDate),
        receiptPath,
        participants: {
          create: shares.map((share) => ({
            userId: share.userId,
            shareMinor: share.shareMinor,
            status: share.userId === user.id ? "SETTLED" : "OPEN",
            settledAt: share.userId === user.id ? new Date() : null,
            settledById: share.userId === user.id ? user.id : null
          }))
        }
      }
    });

    await createNotifications({
      userIds: uniqueParticipants,
      type: NotificationType.EXPENSE_CREATED,
      title: `${parsed.title} добавлен в ${membership.group.name}`,
      message: `${user.name ?? user.email ?? "Кто-то"} добавил(а) общий расход с вами.`,
      link: `/activity/expense/${expense.id}`,
      subject: `Новый общий расход: ${parsed.title}`,
      body: `${user.name ?? user.email ?? "Кто-то"} добавил(а) ${parsed.title} в группе ${membership.group.name}.`
    });

    response.status(201).json({
      id: expense.id,
      groupId: parsed.groupId
    });
  });

  app.post("/api/expenses/participants/:participantId/settle", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = settleExpenseSchema.parse({
      participantId: request.params.participantId
    });

    const participant = await prisma.expenseParticipant.findUnique({
      where: { id: parsed.participantId },
      include: {
        expense: {
          include: {
            group: true,
            payer: true
          }
        },
        user: true
      }
    });

    if (!participant) {
      throw new HttpError(404, "Доля расхода не найдена");
    }

    const isAllowed = participant.userId === user.id || participant.expense.payerId === user.id;

    if (!isAllowed) {
      throw new HttpError(403, "Погасить эту долю может только плательщик или участник");
    }

    if (participant.status !== "OPEN") {
      throw new HttpError(400, "Эта доля уже погашена");
    }

    await prisma.expenseParticipant.update({
      where: { id: participant.id },
      data: {
        status: "SETTLED",
        settledAt: new Date(),
        settledById: user.id
      }
    });

    await createNotifications({
      userIds: [participant.userId, participant.expense.payerId],
      type: NotificationType.DEBT_SETTLED,
      title: `${participant.expense.title} погашен`,
      message: `${participant.user.name ?? participant.user.email ?? "Участник"} погасил(а) свою долю.`,
      link: `/activity/expense/${participant.expenseId}`,
      subject: `Расход погашен: ${participant.expense.title}`,
      body: `${participant.user.name ?? participant.user.email ?? "Участник"} погасил(а) ${participant.expense.title} в группе ${participant.expense.group.name}.`
    });

    response.json({
      id: participant.expenseId
    });
  });

  app.post("/api/debts", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = createDirectDebtSchema.parse({
      title: getBodyValue(request.body, "title"),
      amount: getBodyValue(request.body, "amount"),
      currencyCode: getBodyValue(request.body, "currencyCode").toUpperCase(),
      debtDate: getBodyValue(request.body, "debtDate"),
      note: getOptionalBodyValue(request.body, "note"),
      direction: getBodyValue(request.body, "direction"),
      borrowerId: getOptionalBodyValue(request.body, "borrowerId"),
      borrowerEmail: getOptionalBodyValue(request.body, "borrowerEmail"),
      externalCounterpartyName: getOptionalBodyValue(request.body, "externalCounterpartyName")
    });

    let counterparty = parsed.borrowerId
      ? await prisma.user.findUnique({
          where: {
            id: parsed.borrowerId
          }
        })
      : null;

    if (!counterparty && parsed.borrowerEmail) {
      counterparty = await prisma.user.findFirst({
        where: {
          email: {
            equals: parsed.borrowerEmail,
            mode: "insensitive"
          }
        }
      });
    }

    if (!counterparty && !parsed.externalCounterpartyName) {
      throw new HttpError(404, "Пользователь с таким email не найден. Введите имя человека без аккаунта");
    }

    if (counterparty?.id === user.id) {
      throw new HttpError(400, "Выберите другого человека");
    }

    const amountMinor = parseMoneyToMinorUnits(parsed.amount);
    const lenderId = parsed.direction === "owed_to_me" ? user.id : (counterparty?.id ?? null);
    const borrowerId = parsed.direction === "owed_to_me" ? (counterparty?.id ?? null) : user.id;

    const debt = await prisma.directDebt.create({
      data: {
        title: parsed.title,
        note: parsed.note || null,
        amountMinor,
        currencyCode: parsed.currencyCode,
        debtDate: new Date(parsed.debtDate),
        lenderId,
        borrowerId,
        externalCounterpartyName: counterparty ? null : parsed.externalCounterpartyName,
        externalCounterpartyEmail: counterparty ? null : (parsed.borrowerEmail ?? null),
        createdById: user.id,
        updatedById: user.id
      }
    });

    await createNotifications({
      userIds: getDirectDebtUserIds(lenderId, borrowerId),
      type: NotificationType.DIRECT_DEBT_CREATED,
      title: `${parsed.title} создан`,
      message: `${user.name ?? user.email ?? "Кто-то"} создал(а) личный долг.`,
      link: `/activity/debt/${debt.id}`,
      subject: `Новый личный долг: ${parsed.title}`,
      body: `${user.name ?? user.email ?? "Кто-то"} создал(а) личный долг «${parsed.title}».`
    });

    response.status(201).json({
      id: debt.id
    });
  });

  app.patch("/api/debts/:debtId", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = updateDirectDebtSchema.parse({
      debtId: request.params.debtId,
      title: getBodyValue(request.body, "title"),
      amount: getBodyValue(request.body, "amount"),
      currencyCode: getBodyValue(request.body, "currencyCode").toUpperCase(),
      debtDate: getBodyValue(request.body, "debtDate"),
      note: getOptionalBodyValue(request.body, "note")
    });

    const debt = await prisma.directDebt.findUnique({
      where: {
        id: parsed.debtId
      }
    });

    if (!debt || (debt.lenderId !== user.id && debt.borrowerId !== user.id)) {
      throw new HttpError(404, "Долг не найден");
    }

    if (debt.status !== DirectDebtStatus.OPEN) {
      throw new HttpError(400, "Погашенный долг нельзя редактировать");
    }

    await prisma.directDebt.update({
      where: { id: parsed.debtId },
      data: {
        title: parsed.title,
        note: parsed.note || null,
        amountMinor: parseMoneyToMinorUnits(parsed.amount),
        currencyCode: parsed.currencyCode,
        debtDate: new Date(parsed.debtDate),
        updatedById: user.id
      }
    });

    await createNotifications({
      userIds: getDirectDebtUserIds(debt.lenderId, debt.borrowerId),
      type: NotificationType.DIRECT_DEBT_UPDATED,
      title: `${parsed.title} обновлён`,
      message: `${user.name ?? user.email ?? "Кто-то"} обновил(а) личный долг.`,
      link: `/activity/debt/${debt.id}`,
      subject: `Личный долг обновлён: ${parsed.title}`,
      body: `${user.name ?? user.email ?? "Кто-то"} обновил(а) ${parsed.title}.`
    });

    response.json({
      id: debt.id
    });
  });

  app.post("/api/debts/:debtId/settle", async (request, response) => {
    const user = getAuthenticatedUser(request);
    const parsed = settleDirectDebtSchema.parse({
      debtId: request.params.debtId
    });

    const debt = await prisma.directDebt.findUnique({
      where: { id: parsed.debtId },
      include: {
        lender: true,
        borrower: true
      }
    });

    if (!debt || (debt.lenderId !== user.id && debt.borrowerId !== user.id)) {
      throw new HttpError(404, "Долг не найден");
    }

    if (debt.status !== DirectDebtStatus.OPEN) {
      throw new HttpError(400, "Долг уже погашен");
    }

    await prisma.directDebt.update({
      where: { id: debt.id },
      data: {
        status: DirectDebtStatus.SETTLED,
        settledAt: new Date(),
        settledById: user.id
      }
    });

    await createNotifications({
      userIds: getDirectDebtUserIds(debt.lenderId, debt.borrowerId),
      type: NotificationType.DEBT_SETTLED,
      title: `${debt.title} погашен`,
      message: `${user.name ?? user.email ?? "Кто-то"} отметил(а) этот долг как оплаченный.`,
      link: `/activity/debt/${debt.id}`,
      subject: `Долг погашен: ${debt.title}`,
      body: `${user.name ?? user.email ?? "Кто-то"} отметил(а) ${debt.title} как погашенный.`
    });

    response.json({
      id: debt.id
    });
  });

  app.post("/api/notifications/:notificationId/read", async (request, response) => {
    const user = getAuthenticatedUser(request);

    await prisma.notification.updateMany({
      where: {
        id: request.params.notificationId,
        userId: user.id
      },
      data: {
        readAt: new Date()
      }
    });

    response.json({
      ok: true
    });
  });

  app.use((_request, _response, next) => {
    next(new HttpError(404, "Маршрут не найден"));
  });

  app.use(errorHandler);

  return app;
}
