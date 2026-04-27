import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, "Название должно быть не короче 2 символов").max(40, "Название слишком длинное"),
  currencyCode: z.string().trim().length(3, "Код валюты должен состоять из 3 символов")
});

export const joinGroupSchema = z.object({
  inviteCode: z.string().trim().min(6, "Введите корректный код приглашения").max(20, "Введите корректный код приглашения")
});

export const groupSettingsSchema = z.object({
  groupId: z.string().min(1, "Группа не найдена"),
  name: z.string().trim().min(2, "Название должно быть не короче 2 символов").max(40, "Название слишком длинное"),
  currencyCode: z.string().trim().length(3, "Код валюты должен состоять из 3 символов")
});

export const updateMemberRoleSchema = z.object({
  groupId: z.string().min(1, "Группа не найдена"),
  memberId: z.string().min(1, "Участник не найден"),
  role: z.enum(["ADMIN", "MEMBER"])
});

export const removeMemberSchema = z.object({
  groupId: z.string().min(1, "Группа не найдена"),
  memberId: z.string().min(1, "Участник не найден")
});

export const createExpenseSchema = z.object({
  groupId: z.string().min(1, "Выберите группу"),
  title: z.string().trim().min(2, "Название должно быть не короче 2 символов").max(60, "Название слишком длинное"),
  amount: z.string().trim().min(1, "Введите сумму"),
  expenseDate: z.string().trim().min(1, "Выберите дату"),
  note: z.string().trim().max(240, "Заметка слишком длинная").optional(),
  participantIds: z.array(z.string().min(1)).min(1, "Выберите хотя бы одного участника")
});

export const createDirectDebtSchema = z
  .object({
    title: z.string().trim().min(2, "Название должно быть не короче 2 символов").max(60, "Название слишком длинное"),
    amount: z.string().trim().min(1, "Введите сумму"),
    currencyCode: z.string().trim().length(3, "Код валюты должен состоять из 3 символов"),
    debtDate: z.string().trim().min(1, "Выберите дату"),
    note: z.string().trim().max(240, "Заметка слишком длинная").optional(),
    direction: z.enum(["owed_to_me", "i_owe"]),
    borrowerId: z.string().optional(),
    borrowerEmail: z.string().trim().email("Введите корректный email").optional(),
    externalCounterpartyName: z.string().trim().min(2, "Имя должно быть не короче 2 символов").max(60, "Имя слишком длинное").optional()
  })
  .refine((value) => value.borrowerId || value.borrowerEmail || value.externalCounterpartyName, {
    message: "Выберите человека, введите email или имя",
    path: ["borrowerId"]
  });

export const addFriendSchema = z
  .object({
    email: z.string().trim().email("Введите корректный email").optional(),
    userId: z.string().trim().regex(/^[0-9a-f]{24}$/i, "Пользователь не найден").optional()
  })
  .refine((value) => value.email || value.userId, {
    message: "Выберите пользователя или введите email",
    path: ["email"]
  });

export const updateDirectDebtSchema = z.object({
  debtId: z.string().min(1, "Долг не найден"),
  title: z.string().trim().min(2, "Название должно быть не короче 2 символов").max(60, "Название слишком длинное"),
  amount: z.string().trim().min(1, "Введите сумму"),
  currencyCode: z.string().trim().length(3, "Код валюты должен состоять из 3 символов"),
  debtDate: z.string().trim().min(1, "Выберите дату"),
  note: z.string().trim().max(240, "Заметка слишком длинная").optional()
});

export const settleExpenseSchema = z.object({
  participantId: z.string().min(1, "Доля расхода не найдена")
});

export const settleDirectDebtSchema = z.object({
  debtId: z.string().min(1, "Долг не найден")
});
