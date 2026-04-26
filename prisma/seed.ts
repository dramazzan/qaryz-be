import { PrismaClient, GroupRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [alia, marat] = await Promise.all([
    prisma.user.upsert({
      where: { email: "alia@example.com" },
      update: {},
      create: {
        email: "alia@example.com",
        name: "Alia"
      }
    }),
    prisma.user.upsert({
      where: { email: "marat@example.com" },
      update: {},
      create: {
        email: "marat@example.com",
        name: "Marat"
      }
    })
  ]);

  let group = await prisma.group.findFirst({
    where: {
      name: "Family",
      createdById: alia.id
    }
  });

  if (!group) {
    group = await prisma.group.create({
      data: {
        name: "Family",
        currencyCode: "USD",
        createdById: alia.id
      }
    });
  }

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: alia.id
      }
    },
    update: { role: GroupRole.OWNER },
    create: {
      groupId: group.id,
      userId: alia.id,
      role: GroupRole.OWNER
    }
  });

  await prisma.groupMember.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: marat.id
      }
    },
    update: { role: GroupRole.MEMBER },
    create: {
      groupId: group.id,
      userId: marat.id,
      role: GroupRole.MEMBER
    }
  });

  await prisma.groupInvite.upsert({
    where: {
      groupId: group.id
    },
    update: {
      code: "DEMOFAMILY"
    },
    create: {
      groupId: group.id,
      createdById: alia.id,
      code: "DEMOFAMILY"
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
