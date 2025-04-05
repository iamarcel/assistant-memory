import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_API_BASE_URL: z.string().min(1),

  JINA_API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
