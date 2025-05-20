import { assistantDreamJob } from "./jobs/atlas-assistant";
import { processAtlasJob } from "./jobs/atlas-user";
import { CleanupGraphJobInputSchema } from "./jobs/cleanup-graph";
import { dream } from "./jobs/dream";
import { DeepResearchJobInputSchema } from "./schemas/deep-research";
import { IngestConversationJobInputSchema } from "./jobs/ingest-conversation";
import { IngestDocumentJobInputSchema } from "./jobs/ingest-document";
import { summarizeUserConversations } from "./jobs/summarize-conversation";
import { FlowProducer, Queue, Worker } from "bullmq";
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

export const flowProducer = new FlowProducer({ connection });

// Define Job Data Schemas (using Zod could be an option here too)
interface SummarizeJobData {
  userId: string;
}

export interface DreamJobData {
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

        await dream({
          userId,
          assistantDescription,
        });

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
        
        // Queue deep research job if there are messages
        if (messages.length > 0) {
          // Simple throttling: add a low probability to reduce job frequency
          // This helps prevent too many jobs for users with many short conversations
          if (Math.random() < env.DEEP_RESEARCH_PROBABILITY || 0.5) {
            await batchQueue.add("deep-research", {
              userId,
              conversationId,
              messages,
              lastNMessages: 3,
            }, {
              removeOnComplete: true,
              removeOnFail: 50,
            });
            console.log(`Queued deep research job for conversation ${conversationId}`);
          }
        }
      } else if (job.name === "deep-research") {
        const { userId, conversationId, messages, lastNMessages } =
          DeepResearchJobInputSchema.parse(job.data);
        console.log(
          `Starting deep-research job for user ${userId}, conversation ${conversationId}`,
        );

        const { performDeepResearch } = await import(
          "./jobs/deep-research"
        );
        await performDeepResearch({
          userId,
          conversationId,
          messages,
          lastNMessages,
        });
        console.log(
          `Completed deep research for conversation ${conversationId} for user ${userId}.`,
        );
      } else if (job.name === "ingest-document") {
        const { userId, documentId, content, timestamp } =
          IngestDocumentJobInputSchema.parse(job.data);
        console.log(
          `Starting ingest-document job for user ${userId}, document ${documentId}`,
        );

        const { ingestDocument } = await import(
          "./jobs/ingest-document"
        );
        await ingestDocument({
          db,
          userId,
          documentId,
          content,
          timestamp,
        });
        console.log(
          `Ingested document ${documentId} for user ${userId}.`,
        );
      } else if (job.name === "cleanup-graph") {
        const data = CleanupGraphJobInputSchema.parse({
          ...job.data,
          llmModelId: env.MODEL_ID_GRAPH_EXTRACTION,
        });
        console.log(
          `Starting cleanup-graph job for user ${data.userId}, since ${data.since.toISOString()}`,
        );

        const { runIterativeCleanup } = await import("./jobs/run-iterative-cleanup");
        await runIterativeCleanup({
          ...data,
          iterations: 5, // default to 5 iterations per run
          seedsPerIteration: data.entryNodeLimit,
        });
        console.log(`Cleanup-graph completed for user ${data.userId}.`);
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
