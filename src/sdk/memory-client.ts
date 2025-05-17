import {
  CleanupRequest,
  CleanupResponse,
  cleanupResponseSchema,
} from "../lib/schemas/cleanup.js";
import {
  DreamRequest,
  DreamResponse,
  dreamResponseSchema,
} from "../lib/schemas/dream.js";
import {
  IngestConversationRequest,
  IngestConversationResponse,
  ingestConversationResponseSchema,
} from "../lib/schemas/ingest-conversation.js";
import {
  IngestDocumentRequest,
  IngestDocumentResponse,
  ingestDocumentResponseSchema,
} from "../lib/schemas/ingest-document-request.js";
import {
  QueryAtlasRequest,
  QueryAtlasResponse,
  queryAtlasResponseSchema,
} from "../lib/schemas/query-atlas.js";
import {
  QueryDayRequest,
  QueryDayResponse,
  queryDayResponseSchema,
} from "../lib/schemas/query-day.js";
import {
  QueryNodeTypeRequest,
  QueryNodeTypeResponse,
  queryNodeTypeResponseSchema,
} from "../lib/schemas/query-node-type.js";
import {
  QuerySearchRequest,
  QuerySearchResponse,
  querySearchResponseSchema,
} from "../lib/schemas/query-search.js";
import {
  SummarizeRequest,
  SummarizeResponse,
  summarizeResponseSchema,
} from "../lib/schemas/summarize.js";
import { z } from "zod";

export interface MemoryClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export class MemoryClient {
  private options: MemoryClientOptions;

  constructor(options: MemoryClientOptions) {
    this.options = options;
  }

  private async _fetch<
    TRequest,
    S extends z.ZodTypeAny,
    TResponse = z.infer<S>,
  >(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    responseSchema: S,
    body?: TRequest,
  ): Promise<TResponse> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(
      `${this.options.baseUrl}${path}`,
      fetchOptions,
    );

    if (!response.ok) {
      // Attempt to parse error response for more details
      const errorBody = await response.json();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}${errorBody ? ` - ${JSON.stringify(errorBody)}` : ""}`,
      );
    }

    const responseData = await response.json();
    return responseSchema.parse(responseData);
  }

  async ingestDocument(
    payload: IngestDocumentRequest,
  ): Promise<IngestDocumentResponse> {
    return this._fetch(
      "POST",
      "/ingest/document",
      ingestDocumentResponseSchema,
      payload,
    );
  }

  async ingestConversation(
    payload: IngestConversationRequest,
  ): Promise<IngestConversationResponse> {
    return this._fetch(
      "POST",
      "/ingest/conversation",
      ingestConversationResponseSchema,
      payload,
    );
  }

  async querySearch(payload: QuerySearchRequest): Promise<QuerySearchResponse> {
    return this._fetch(
      "POST",
      "/query/search",
      querySearchResponseSchema,
      payload,
    );
  }

  async queryAtlas(payload: QueryAtlasRequest): Promise<QueryAtlasResponse> {
    return this._fetch(
      "POST",
      "/query/atlas",
      queryAtlasResponseSchema,
      payload,
    );
  }

  async queryDay(payload: QueryDayRequest): Promise<QueryDayResponse> {
    return this._fetch("POST", "/query/day", queryDayResponseSchema, payload);
  }

  async queryNodeType(
    payload: QueryNodeTypeRequest,
  ): Promise<QueryNodeTypeResponse> {
    return this._fetch(
      "POST",
      "/query/node-type",
      queryNodeTypeResponseSchema,
      payload,
    );
  }

  async summarize(payload: SummarizeRequest): Promise<SummarizeResponse> {
    return this._fetch("POST", "/summarize", summarizeResponseSchema, payload);
  }

  async cleanup(payload: CleanupRequest): Promise<CleanupResponse> {
    return this._fetch("POST", "/cleanup", cleanupResponseSchema, payload);
  }

  async dream(payload: DreamRequest): Promise<DreamResponse> {
    return this._fetch("POST", "/dream", dreamResponseSchema, payload);
  }
}
