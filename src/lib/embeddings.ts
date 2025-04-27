import { z } from "zod";
import { env } from "~/utils/env";

const EmbeddingTypeSchema = z.enum(["float", "base64", "binary", "ubinary"]);
type EmbeddingType = z.infer<typeof EmbeddingTypeSchema>;

const TaskSchema = z.enum([
  "retrieval.query",
  "retrieval.passage",
  "text-matching",
  "classification",
  "separation",
]);
export type EmbeddingTask = z.infer<typeof TaskSchema>;

const ColbertInputTypeSchema = z.enum(["query", "document"]);
export type ColbertInputType = z.infer<typeof ColbertInputTypeSchema>;

const BaseFields = {
  embedding_type: EmbeddingTypeSchema.optional(),
  task: TaskSchema.optional(),
  dimensions: z.number().int().min(1).max(1024).optional(),
  normalized: z.boolean().optional(),
  late_chunking: z.boolean().optional(),
};

// jina-embeddings-v3: text only
const TextModelSchema = z.object({
  model: z.literal("jina-embeddings-v3"),
  input: z.array(z.string()).min(1),
  truncate: z.boolean().optional().default(true),
  ...BaseFields,
});

// jina-clip-v2: text and/or image
const ClipModelSchema = z.object({
  model: z.literal("jina-clip-v2"),
  input: z.array(z.union([z.string(), z.object({ image: z.string() })])).min(1),
  ...BaseFields,
});

// jina-colbert-v2: text only, needs input_type
const ColbertModelSchema = z.object({
  model: z.literal("jina-colbert-v2"),
  input: z.array(z.string()).min(1),
  input_type: ColbertInputTypeSchema,
  embedding_type: z.literal("float").optional(),
  dimensions: z
    .union([z.literal(128), z.literal(96), z.literal(64)])
    .optional(),
});

const EmbeddingInputSchema = z.union([
  TextModelSchema,
  ClipModelSchema,
  ColbertModelSchema,
]);
type EmbeddingInput = z.infer<typeof EmbeddingInputSchema>;

type FloatEmbeddingResponse = {
  data: { embedding: number[] }[];
  usage: { total_tokens: number };
};

type EncodedEmbeddingResponse = {
  data: { embedding: string }[];
  usage: { total_tokens: number };
};

type MultiVectorResponse = {
  data: { embeddings: number[][] }[];
  usage?: { total_tokens?: number };
};

type EmbeddingResponseMap = {
  float: FloatEmbeddingResponse;
  base64: EncodedEmbeddingResponse;
  binary: EncodedEmbeddingResponse;
  ubinary: EncodedEmbeddingResponse;
};

type MultiVectorResponseMap = {
  float: MultiVectorResponse;
};

export async function generateEmbeddings<T extends EmbeddingType = "float">(
  params: EmbeddingInput & { embedding_type?: T },
): Promise<
  T extends "float"
    ? typeof params extends { model: "jina-colbert-v2" }
      ? MultiVectorResponseMap["float"]
      : EmbeddingResponseMap["float"]
    : EmbeddingResponseMap[T]
> {
  const validated = EmbeddingInputSchema.parse(params);

  const url =
    validated.model === "jina-colbert-v2"
      ? "https://api.jina.ai/v1/multi-vector"
      : "https://api.jina.ai/v1/embeddings";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JINA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    console.error(await response.text());
    throw new Error(
      `Jina API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}
