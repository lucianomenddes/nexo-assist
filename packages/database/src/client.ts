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
  const [role] = await prisma.$queryRaw<
    Array<{ rolsuper: boolean; rolbypassrls: boolean }>
  >`
    SELECT rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `;

  if (!role) {
    throw new Error("Could not identify the PostgreSQL runtime role.");
  }

  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      "DATABASE_URL must use a non-superuser PostgreSQL role without BYPASSRLS.",
    );
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  await prisma.$disconnect();
}
