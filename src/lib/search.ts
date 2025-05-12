import type { TypeId } from "~/types/typeid";
import {
  findSimilarNodes as graphFindSimilarNodes,
  findOneHopConnections as graphFindOneHopConnections,
  processSearchResultsWithConnections as graphProcessResults,
  formatAsMarkdown as graphFormatAsMarkdown,
  NodeSearchResult,
  ConnectionRecord,
  NodeWithConnections,
  GraphResults,
  FindSimilarNodesOptions,
} from "~/lib/graph";

/** Delegate to graph.findSimilarNodes */
export function findSimilarNodes(
  opts: FindSimilarNodesOptions,
): Promise<NodeSearchResult[]> {
  return graphFindSimilarNodes(opts);
}

/** Delegate to graph.findOneHopConnections */
export function findOneHopConnections(
  db: Awaited<ReturnType<typeof import("~/utils/db").useDatabase>>,
  userId: string,
  nodeIds: TypeId<"node">[],
  onlyWithLabels = true,
): Promise<ConnectionRecord[]> {
  return graphFindOneHopConnections(db, userId, nodeIds, onlyWithLabels);
}

/** Delegate to graph.processSearchResultsWithConnections */
export function processSearchResultsWithConnections(
  directMatches: NodeSearchResult[],
  neighbors: ConnectionRecord[],
): GraphResults {
  return graphProcessResults(directMatches, neighbors);
}

/** Delegate to graph.formatAsMarkdown */
export function formatSearchResultsAsString(
  query: string,
  allNodes: NodeWithConnections[],
  directMatches: NodeWithConnections[],
): string {
  return graphFormatAsMarkdown(query, allNodes, directMatches);
}

// Re-export types
export type {
  NodeSearchResult,
  ConnectionRecord,
  NodeWithConnections,
  GraphResults,
  FindSimilarNodesOptions,
};
