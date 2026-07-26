import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

console.log("DATABASE_URL =", process.env.DATABASE_URL);

try {
    console.log("Connecting...");
    await prisma.$connect();
    console.log("✅ Connected");

    const result = await prisma.$queryRaw`SELECT 1`;
    console.log(result);

    await prisma.$disconnect();
    console.log("Done");
} catch (err) {
    console.error(err);
}