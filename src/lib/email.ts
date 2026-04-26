import { EmailDeliveryStatus } from "@prisma/client";
import { Resend } from "resend";

import { prisma } from "@/lib/prisma";

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("Не настроен Resend API key");
  }

  return new Resend(apiKey);
}

export async function sendPendingEmails(limit = 20) {
  const resend = getResendClient();
  const from = process.env.RESEND_FROM_EMAIL;

  if (!from) {
    throw new Error("Не настроен email отправителя");
  }

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
      await resend.emails.send({
        from,
        to: [delivery.toEmail],
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
