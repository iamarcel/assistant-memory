import { z } from "zod";

// This schema assumes that a successful POST to /api/messages
// will return a JSON response, even if it's just an empty object.
// If the endpoint might return a 204 No Content or non-JSON response on success,
// the _fetch method in MemoryClient might need adjustment.
export const messagesResponseSchema = z.object({}).passthrough();

export type MessagesResponse = z.infer<typeof messagesResponseSchema>;

// The SDK method for this endpoint will likely take sessionId (for the query param)
// and a payload (for the POST body) as separate arguments.
// Example SDK method signature:
// async postMessage(sessionId: string, payload: unknown): Promise<MessagesResponse>
