import { EmailDeliveryStatus } from "@prisma/client";
import nodemailer from "nodemailer";

import { prisma } from "@/lib/prisma";

function getGoogleSmtpConfig() {
  const user = process.env.GOOGLE_SMTP_USER;
  const pass = process.env.GOOGLE_SMTP_APP_PASSWORD;

  if (!user) {
    throw new Error("Не настроен GOOGLE_SMTP_USER");
  }

  if (!pass) {
    throw new Error("Не настроен GOOGLE_SMTP_APP_PASSWORD");
  }

  return {
    user,
    pass,
    from: process.env.GOOGLE_SMTP_FROM ?? user
  };
}

export async function sendPendingEmails(limit = 20) {
  const { user, pass, from } = getGoogleSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user,
      pass
    }
  });

  const deliveries = await prisma.emailDelivery.findMany({
    where: {
      OR: [
        { status: EmailDeliveryStatus.PENDING },
        { status: EmailDeliveryStatus.FAILED, attempts: { lt: 3 } }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  for (const delivery of deliveries) {
    try {
      await transporter.sendMail({
        from,
        to: delivery.toEmail,
        subject: delivery.subject,
        text: delivery.body
      });

      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: EmailDeliveryStatus.SENT,
          sentAt: new Date(),
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
          lastError: null
        }
      });
    } catch (error) {
      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: EmailDeliveryStatus.FAILED,
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message : "Неизвестная ошибка отправки"
        }
      });
    }
  }

  return deliveries.length;
}
