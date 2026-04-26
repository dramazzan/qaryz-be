import { createBackendApp } from "@/backend/app";
import { prisma } from "@/lib/prisma";

const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);
const app = createBackendApp();

async function start() {
  try {
    await prisma.$connect();
    console.log("Database connection established");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    console.error("Check your DATABASE_URL and ensure the database is reachable.");
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`Express API listening on http://127.0.0.1:${port}`);
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
