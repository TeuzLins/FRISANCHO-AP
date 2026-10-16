import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await db.$disconnect();
console.log(`${count} sessões expiradas removidas.`);
