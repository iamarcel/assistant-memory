import type OpenAI from "openai";

export async function createCompletionClient(userId: string): Promise<OpenAI> {
  const { OpenAI } = await import("openai");
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_API_BASE_URL,
    defaultHeaders: {
      ...(env.HELICONE_API_KEY
        ? {
            "Helicone-Auth": `Bearer ${env.HELICONE_API_KEY}`,
            "Helicone-User-Id": userId,
          }
        : {}),
      "HTTP-Referer": "https://github.com/iamarcel/assistant-memory",
      "X-Title": "Assistant Memory",
    },
  });
}
