/**
 * scripts/clear-queue.ts
 * 
 * 這是一支用來在開發階段強制清除 BullMQ (Redis) 卡彈與幽靈排程的實用腳本。
 * 當 Worker 因為被強制關閉 (Ctrl+C) 導致任務被鎖定五分鐘 (lockDuration) 時，
 * 你可以隨時執行此腳本來清空整個佇列，讓系統重新來過。
 *
 * 【使用方式】
 * npm run clear-queue
 * 或
 * npx tsx scripts/clear-queue.ts
 */

import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../src/lib/queue/jobs";
import { redisConnection } from "../src/lib/queue/client";

async function clearQueue() {
    console.log(`\n🧹 準備清除佇列: ${QUEUE_NAMES.PARSER} ...`);

    // 初始化連線到相同的 BullMQ Queue
    const parserQueue = new Queue(QUEUE_NAMES.PARSER, { connection: redisConnection });

    try {
        // 先暫停佇列以防止在我們清除的時候有新的 Job 塞進來
        await parserQueue.pause();

        // 刪除不同狀態的任務
        await parserQueue.obliterate({ force: true });
        console.log(`✅ 已成功完全清空 BullMQ 所有未處理、執行中與失敗的任務！`);

    } catch (error) {
        console.error(`❌ 清除失敗:`, error);
    } finally {
        // 記得關閉連線，否則腳本不會結束
        await parserQueue.close();
        process.exit(0);
    }
}

clearQueue();
