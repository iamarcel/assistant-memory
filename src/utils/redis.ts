import IORedis from "ioredis";
import { env } from "./env";

// Create a Redis client for storing/retrieving data
export const redisClient = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisClient.on("error", (err) => {
  console.error("Redis client connection error:", err);
});