import { z } from "zod";
import { env } from "~/utils/env";

const RerankRequestSchema = z.object({
  query: z.string(),
  top_n: z.number().int().min(1).max(50).default(10),
  documents: z.array(z.string()).min(1),
  return_documents: z.boolean().default(false),
});

export type RerankRequest = z.input<typeof RerankRequestSchema>;

const RerankResponseSchema = z.object({
  model: z.string().optional(),
  usage: z
    .object({
      total_tokens: z.number(),
    })
    .optional(),
  results: z.array(
    z.object({
      index: z.number().int(),
      relevance_score: z.number(),
    }),
  ),
});

type RerankResponse = z.infer<typeof RerankResponseSchema>;

// Generic Zod schema for RerankResult items
export const rerankResultItemSchema = <T extends z.ZodTypeAny>(itemSchema: T) => 
  z.object({
    group: z.string(),
    item: itemSchema,
    relevance_score: z.number(),
  });

export const rerank = async (req: RerankRequest): Promise<RerankResponse> => {
  const validated = RerankRequestSchema.parse(req);

  const response = await fetch("https://api.jina.ai/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JINA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: "jina-reranker-v2-base-multilingual",
      ...validated,
    }),
  });

  if (!response.ok) {
    console.error(await response.text());
    throw new Error(
      `Jina API error: ${response.status} ${response.statusText}`,
    );
  }

  return RerankResponseSchema.parse(await response.json());
};

// A group of items with a mapper to the reranker’s document input
export type RerankGroup<Item> = {
  items: Item[];
  toDocument: (item: Item) => string;
};

// Union result type preserving group key and item type
export type RerankResult<Groups extends Record<string, unknown>> = {
  [K in keyof Groups]: { group: K; item: Groups[K]; relevance_score: number };
}[keyof Groups][];

/**
 * Rerank multiple heterogeneous groups together.
 *
 * @param query  The query string for reranking
 * @param groups An object mapping group keys to their items and document mapper
 * @param top_n  Optional max number of top results (defaults via schema)
 * @returns      Array of reranked results with group key, original item, and score
 */
export async function rerankMultiple<Groups extends Record<string, unknown>>(
  query: string,
  groups: { [K in keyof Groups]: RerankGroup<Groups[K]> },
  top_n?: number,
): Promise<RerankResult<Groups>> {
  const flat: Array<{
    group: keyof Groups;
    index: number;
    item: Groups[keyof Groups];
    doc: string;
  }> = [];
  (Object.keys(groups) as Array<keyof Groups>).forEach((groupKey) => {
    const { items, toDocument } = groups[groupKey];
    items.forEach((item, index) =>
      flat.push({ group: groupKey, index, item, doc: toDocument(item) }),
    );
  });
  if (flat.length === 0) return [];

  const documents = flat.map((f) => f.doc);
  const resp = await rerank({
    query,
    documents,
    ...(top_n !== undefined ? { top_n } : {}),
  });

  return resp.results.map((r) => {
    const f = flat[r.index]!;
    return { group: f.group, item: f.item, relevance_score: r.relevance_score };
  });
}
