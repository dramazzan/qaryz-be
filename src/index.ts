import { createBackendApp } from "@/backend/app";
import { prisma } from "@/lib/prisma";

const port = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000);
const app = createBackendApp();

async function start() {
  try {
    await prisma.$connect();
    await prisma.$runCommandRaw({ ping: 1 });
    console.log("Database connection established");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    console.error("Check your DATABASE_URL and ensure the database is reachable.");
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`Express API listening on port ${port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
