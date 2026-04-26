import { NotificationType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type NotificationInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  subject: string;
  body: string;
};

export async function createNotifications(input: NotificationInput) {
  const uniqueUserIds = [...new Set(input.userIds)];

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: uniqueUserIds
      }
    },
    select: {
      id: true,
      email: true
    }
  });

  const created = await prisma.$transaction(
    users.map((user) =>
      prisma.notification.create({
        data: {
          userId: user.id,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          emails: user.email
            ? {
                create: {
                  userId: user.id,
                  toEmail: user.email,
                  subject: input.subject,
                  body: input.body
                }
              }
            : undefined
        }
      })
    )
  );

  return created;
}
