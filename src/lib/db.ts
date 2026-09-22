import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __sd_prisma?: PrismaClient };

export const prisma: PrismaClient =
  g.__sd_prisma ??
  (g.__sd_prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error"] : ["error"],
  }));
