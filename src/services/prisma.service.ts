import { PrismaClient } from "@prisma/client";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0);

export const isDatabaseReady = (): boolean => hasDatabaseUrl;

export const prisma = new PrismaClient({
  log: ["warn", "error"],
});
