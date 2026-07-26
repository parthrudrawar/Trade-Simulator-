import { PrismaClient } from "@prisma/client";

// Singleton pattern: PrismaClient is expensive to create (connection pool init).
// Stored on `globalThis` to survive hot-reloads in development.
// Without this, `node --watch` or `nodemon` would leak connections on every restart.

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
