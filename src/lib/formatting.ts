import { formatISO } from "date-fns";
import type {
  NodeWithConnections,
  NodeSearchResult,
  EdgeSearchResult,
  OneHopNode,
} from "~/lib/graph";
import type { RerankResult } from "~/lib/rerank";

interface Message {
  content: string;
  role: string;
  name?: string | undefined;
  timestamp: string | number | Date;
}

/**
 * Converts conversation messages to an XML-like format for LLM processing
 */
export function formatConversationAsXml(messages: Message[]): string {
  return messages
    .map(
      (message, index) =>
        `<message id="${index}" role="${message.role}" ${message.name ? `name="${message.name}"` : ""} timestamp="${formatISO(message.timestamp)}">
      <content>${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</content>
    </message>`,
    )
    .join("\n");
}

/** Escape special characters for XML */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Converts nodes to XML-like format for LLM prompts
 */
export function formatNodesForPrompt(
  existingNodes: Array<{
    id: string;
    type: string;
    label: string | null;
    description?: string | null;
    tempId: string;
    timestamp: string;
  }>,
): string {
  if (existingNodes.length === 0) {
    return "";
  }

  const xmlItems = existingNodes
    .map(
      (node) =>
        `<node id="${escapeXml(node.tempId)}" type="${escapeXml(node.type)}" timestamp="${node.timestamp}">
  <label>${node.label ?? ""}</label>
  <description>${node.description || ""}</description>
</node>`,
    )
    .join("\n");

  return `<nodes>
${xmlItems}
</nodes>`;
}

/**
 * Formats a list of label/description pairs as XML
 */
export function formatLabelDescList(
  items: Array<{ label?: string | null; description?: string | null }>,
): string {
  if (items.length === 0) {
    return "";
  }

  const xmlItems = items
    .map(
      (item) => `<item label="${escapeXml(item.label ?? "Unnamed")}"
>${item.description ?? ""}</item>`,
    )
    .join("\n");
  return `<items>
${xmlItems}
</items>`;
}

/**
 * Formats search results as a readable markdown string
 */
export function formatAsMarkdown(
  query: string,
  allNodes: NodeWithConnections[],
  directMatches: NodeWithConnections[],
): string {
  let result = `Results for query: "${query}"\n\n`;

  // Direct matches section
  result += `Found ${directMatches.length} direct matches:\n`;
  directMatches.forEach((node, index) => {
    const similarityPercentage = Math.round((node.similarity ?? 0) * 100);
    result += `${index + 1}. ${node.label} (${node.type}, ${node.timestamp.toISOString()}, ${similarityPercentage}% match)\n`;
    if (node.description) {
      result += `   ${node.description}\n`;
    }
    if (node.connectedTo && node.connectedTo.length > 0) {
      result += `   Connected to ${node.connectedTo.length} other nodes\n`;
    }
    result += "\n";
  });

  // One-hop related nodes
  const connectedNodes = allNodes.filter((node) => !node.isDirectMatch);
  if (connectedNodes.length > 0) {
    result += `\nRelated nodes (one hop away):\n`;
    connectedNodes.forEach((node, index) => {
      result += `${index + 1}. ${node.label} (${node.type}, ${node.timestamp.toISOString()})\n`;
      if (node.description) {
        result += `   ${node.description}\n`;
      }
      if (node.connectedTo && node.connectedTo.length > 0) {
        const labels = node.connectedTo
          .map((id) => directMatches.find((n) => n.id === id)?.label)
          .filter(Boolean);
        if (labels.length > 0) {
          result += `   Connected to: ${labels.join(", ")}\n`;
        }
      }
      result += "\n";
    });
  }
  return result;
}

// Group definitions for reranked search results
type SearchGroups = {
  similarNodes: NodeSearchResult;
  similarEdges: EdgeSearchResult;
  connections: OneHopNode;
};

/**
 * Strongly-typed alias for reranked search results.
 */
export type SearchResults = RerankResult<SearchGroups>;

// Helpers for formatting individual result items
function formatSearchNode(node: NodeSearchResult): string {
  return `<node type="${escapeXml(node.type)}" timestamp="${formatISO(node.timestamp)}">
  <label>${node.label ?? ""}</label>
  <description>${node.description ?? ""}</description>
</node>`;
}

function formatSearchEdge(edge: EdgeSearchResult): string {
  return `<edge from="${escapeXml(edge.sourceLabel ?? "")}" to="${escapeXml(
    edge.targetLabel ?? "",
  )}" type="${escapeXml(edge.edgeType)}" timestamp="${formatISO(edge.timestamp)}">
  <description>${escapeXml(edge.description ?? "")}</description>
</edge>`;
}

function formatSearchConnection(conn: OneHopNode): string {
  return `<edge from="${escapeXml(conn.sourceLabel ?? "")}" to="${escapeXml(
    conn.targetLabel ?? "",
  )}" type="${escapeXml(conn.edgeType)}" timestamp="${formatISO(conn.timestamp)}">
  <description>${conn.description ?? ""}</description>
</edge>`;
}

/**
 * Formats reranked search results as an XML-like structure for LLM prompts.
 * Items are ordered by descending relevance and tagged by their group.
 */
export function formatSearchResultsAsXml(results: SearchResults): string {
  const body = results.length
    ? results
        .map((r) => {
          switch (r.group) {
            case "similarNodes":
              return formatSearchNode(r.item);
            case "similarEdges":
              return formatSearchEdge(r.item);
            case "connections":
              return formatSearchConnection(r.item);
          }
        })
        .join("\n")
    : "";
  return body;
}
