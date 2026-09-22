import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 清空 demo 產生的資料（保留種子用戶與活動），回到初始展示狀態 */
async function main() {
  await prisma.ledgerEvent.deleteMany();
  await prisma.connectMessage.deleteMany();
  await prisma.connection.deleteMany();
  await prisma.teamMessage.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.icebreaker.deleteMany();
  await prisma.swarmPart.deleteMany();
  await prisma.soloBaseline.deleteMany();
  await prisma.matchRun.deleteMany();
  await prisma.eventMember.deleteMany({
    where: { user: { isBot: false, id: { not: { startsWith: "seed-" } } } },
  });
  await prisma.agentProfile.deleteMany({
    where: { user: { isBot: false, id: { not: { startsWith: "seed-" } } } },
  });
  await prisma.user.deleteMany({
    where: { isBot: false, id: { not: { startsWith: "seed-" } } },
  });
  console.log("Demo data reset. Seed participants preserved.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
