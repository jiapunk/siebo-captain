import { PrismaClient, Prisma } from "@prisma/client";
import {
  HACK_PERSONAS,
  DEMO_HACKER,
  EVENT_SEED,
} from "../src/lib/personas";
import { HACK_VISIBILITY } from "../src/lib/types";

const prisma = new PrismaClient();

async function main() {
  // 冪等重建：清掉所有種子與其衍生資料
  await prisma.ledgerEvent.deleteMany();
  await prisma.connectMessage.deleteMany();
  await prisma.connection.deleteMany();
  await prisma.teamMessage.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.icebreaker.deleteMany();
  await prisma.matchRun.deleteMany();
  await prisma.eventMember.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany({ where: { id: { startsWith: "seed-" } } });

  // 活動
  const event = await prisma.event.create({
    data: {
      name: process.env.EVENT_NAME || EVENT_SEED.name,
      code: (process.env.EVENT_CODE || EVENT_SEED.code).toUpperCase(),
      startsAt: process.env.EVENT_STARTS_AT
        ? new Date(process.env.EVENT_STARTS_AT)
        : EVENT_SEED.startsAt,
      endsAt: process.env.EVENT_ENDS_AT
        ? new Date(process.env.EVENT_ENDS_AT)
        : EVENT_SEED.endsAt,
    },
  });

  // 參賽者
  for (const p of [DEMO_HACKER, ...HACK_PERSONAS]) {
    const user = await prisma.user.create({
      data: {
        id: `seed-${p.name}`,
        name: p.name,
        emoji: p.emoji,
        tagline: p.tagline,
        isBot: p.isBot,
      },
    });
    await prisma.agentProfile.create({
      data: {
        userId: user.id,
        status: "ready",
        compiled: p.profile as unknown as Prisma.InputJsonValue,
        visibility: {
          ...HACK_VISIBILITY,
        } as unknown as Prisma.InputJsonValue,
        interview: [],
      },
    });
    await prisma.eventMember.create({
      data: { eventId: event.id, userId: user.id },
    });
  }

  const count = await prisma.user.count();
  console.log(`Seeded event「${event.name}」. Participants: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
