import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  try {
    const limit = 50;
    const skip = 0;
    const where = {};
    const [total, tags] = await Promise.all([
        prisma.tag.count({ where }),
        prisma.tag.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ dimension: "asc" }, { groupName: "asc" }, { name: "asc" }],
            include: {
                _count: {
                    select: { questions: true }
                }
            }
        })
    ]);
    console.log("Success:", tags.length);
  } catch(e: any) {
    console.error("Error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main()
