/* eslint-disable no-console -- standalone CLI script */
import { db } from "../lib/db/prisma"

async function main() {
    const drafts = await db.parsedDraft.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    })
    console.log(JSON.stringify(drafts, null, 2))
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect())
