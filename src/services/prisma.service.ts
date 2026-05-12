import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../config/env";

export const isDatabaseReady = (): boolean => Boolean(loadEnv().databaseUrl);

export const prisma = new PrismaClient({
  log: ["warn", "error"],
});
