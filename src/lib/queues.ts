import { assistantDreamJob } from "./jobs/assistant-dream";
import { IngestConversationJobInputSchema } from "./jobs/ingest-conversation";
import { processAtlasJob } from "./jobs/process-atlas";
import { summarizeUserConversations } from "./jobs/summarize-conversation";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { useDatabase } from "~/utils/db";
import { env } from "~/utils/env";

// Define connection options using environment variables
const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Important for BullMQ
});

connection.on("error", (err) => {
  console.error("Redis connection error:", err);
});

// Create the main batch processing queue
export const batchQueue = new Queue("batchProcessing", { connection });

// Define Job Data Schemas (using Zod could be an option here too)
interface SummarizeJobData {
  userId: string;
}

interface DreamJobData {
  userId: string;
  assistantId: string;
  assistantDescription: string;
}

// Create the worker
// Keep the worker in scope even if not explicitly referenced later.
const worker = new Worker<SummarizeJobData | DreamJobData>(
  "batchProcessing",
  async (job) => {
    const db = await useDatabase();
    console.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === "summarize") {
        const { userId } = job.data as SummarizeJobData;
        console.log(`Starting summarize job for user ${userId}`);

        // 1. Summarize conversations
        const summaryResult = await summarizeUserConversations(db, userId);
        console.log(
          `Summarized ${summaryResult.summarizedCount} conversations for user ${userId}.`,
        );

        // 2. Process User Atlas
        await processAtlasJob(db, userId);
        console.log(`Processed user atlas for user ${userId}.`);
      } else if (job.name === "dream") {
        const { userId, assistantId, assistantDescription } =
          job.data as DreamJobData;
        console.log(
          `Starting dream job for user ${userId}, assistant ${assistantId}`,
        );
        // 1. Summarize conversations
        const summaryResult = await summarizeUserConversations(db, userId);
        console.log(
          `Summarized ${summaryResult.summarizedCount} conversations for user ${userId} in dream job.`,
        );
        // 2. Run both Atlas updates in parallel
        await Promise.all([
          processAtlasJob(db, userId),
          assistantDreamJob(db, userId, assistantId, assistantDescription),
        ]);
        console.log(
          `\n\nAssistant dream completed for user ${userId}, assistant ${assistantId}.`,
        );
      } else if (job.name === "ingest-conversation") {
        const { userId, conversationId, messages } =
          IngestConversationJobInputSchema.parse(job.data);
        console.log(
          `Starting ingest-conversation job for user ${userId}, conversation ${conversationId}`,
        );

        const { ingestConversation } = await import(
          "./jobs/ingest-conversation"
        );
        await ingestConversation({
          db,
          userId,
          conversationId,
          messages,
        });
        console.log(
          `Ingested conversation ${conversationId} for user ${userId}.`,
        );
      } else {
        console.warn(`Unknown job type: ${job.name}`);
        throw new Error(`Unknown job type: ${job.name}`);
      }
    } catch (error) {
      console.error(`Job ${job.id} (${job.name}) failed:`, error);
      // Optionally, rethrow the error to have BullMQ mark the job as failed
      throw error;
    }
  },
  { connection },
);

console.log("BullMQ Worker started for batchProcessing queue.");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down BullMQ worker...");
  await worker.close();
  await connection.quit();
  console.log("BullMQ shutdown complete.");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down BullMQ worker...");
  await worker.close();
  await connection.quit();
  console.log("BullMQ shutdown complete.");
  process.exit(0);
});
