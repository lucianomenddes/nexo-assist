import { PrismaClient } from "@prisma/client";
import { loadEnvironment } from "@nexo-assist/config";

const environment = loadEnvironment();
const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: environment.DATABASE_URL,
      },
    },
    log: environment.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (environment.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function closeDatabaseConnection(): Promise<void> {
  await prisma.$disconnect();
}
