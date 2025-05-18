import { env } from "~/utils/env";

/**
 * Generic debug logger controlled via DEBUG_LOGS flag.
 */
export function debug(...args: unknown[]) {
  if (!env.DEBUG_LOGS) return;
  console.debug("[DEBUG]", ...args);
}

/**
 * Pretty-print nodes and edges for debugging.
 */
export function debugGraph<
  N extends {
    id: unknown;
    label: string;
    description?: string | undefined;
    nodeType: unknown;
  },
  E extends {
    sourceNodeId: unknown;
    targetNodeId: unknown;
    edgeType: unknown;
    description?: string | undefined | null;
  },
>(nodes: N[], edges: E[]) {
  if (!env.DEBUG_LOGS) return;
  console.group("🪵 Debug Graph 🔍");
  console.group("Nodes");
  nodes.forEach((n) =>
    console.log(
      `• [${n.id}] (${n.nodeType}) "${n.label}" — ${n.description ?? ""}`,
    ),
  );
  console.groupEnd();
  console.group("Edges");
  edges.forEach((e) =>
    console.log(
      `• ${e.sourceNodeId} → ${e.targetNodeId} (${e.edgeType}): ${e.description}`,
    ),
  );
  console.groupEnd();
  console.groupEnd();
}
