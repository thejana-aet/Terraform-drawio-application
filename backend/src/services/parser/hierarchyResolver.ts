/**
 * Hierarchy Resolver — Recursive Parent-Child Tree Builder
 *
 * Takes flat arrays of RawNodes and ParsedEdges (output of xmlParser) and
 * builds a resolved tree of ParsedNode objects with:
 *
 *   - children[]  — direct child nodes (e.g. EC2 instances inside a Subnet,
 *                   Subnets inside a VPC)
 *   - edges[]     — all edges where this node is source OR target
 *   - metadata    — key-value pairs extracted from the node label
 *   - isContainer — true when the node has at least one child
 *
 * Draw.io parent-child conventions
 * ─────────────────────────────────
 * Every mxCell has a @parent attribute.  Draw.io's default page root has
 * id="1".  Any cell whose @parent is "1" (or null after normalisation) is
 * a top-level / root-level node.  Container shapes (VPCs, Subnets, groups)
 * have child cells whose @parent points to the container's id.
 *
 * Algorithm
 * ─────────
 * 1. Build a flat nodeMap  id → ParsedNode  (O(n) pass)
 * 2. For each node: if it has a parentId that maps to a real node,
 *    push it into parent.children.  Otherwise it's a root node.
 * 3. After the tree is built, walk every edge and attach it to both
 *    its source node and its target node.
 * 4. Mark isContainer and compute metadata in a final DFS pass.
 *
 * Cycle guard
 * ───────────
 * Although Draw.io prevents cycles in the UI, we guard against them during
 * the recursive DFS to avoid stack overflows on malformed input.
 */

import { RawNode, ParsedEdge, ParsedNode } from '../../types/index';
import { extractMetadata } from '../metadata/metadataExtractor';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a flat list of raw nodes and edges into a hierarchical tree.
 *
 * @param rawNodes - Flat node array from `parseDrawioXml`
 * @param edges    - Flat edge array from `parseDrawioXml`
 * @returns        Root-level ParsedNode array (nodes with no parent container)
 */
export function resolveHierarchy(
  rawNodes: RawNode[],
  edges: ParsedEdge[],
): ParsedNode[] {
  // ── Step 1: Build flat nodeMap ───────────────────────────────────────────
  const nodeMap = new Map<string, ParsedNode>();

  for (const raw of rawNodes) {
    const node: ParsedNode = {
      id: raw.id,
      label: raw.label,
      style: raw.style,
      awsServiceKey: raw.awsServiceKey,
      parentId: raw.parentId,
      children: [],
      edges: [],
      metadata: extractMetadata(raw.label),
      isContainer: false,
    };
    nodeMap.set(raw.id, node);
  }

  // ── Step 2: Assign children to their parents ─────────────────────────────
  const rootNodes: ParsedNode[] = [];

  for (const node of nodeMap.values()) {
    if (node.parentId !== null && nodeMap.has(node.parentId)) {
      // Parent exists in graph — attach as child
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      // No parent (or parent is the Draw.io page root "1") — root-level node
      rootNodes.push(node);
    }
  }

  // ── Step 3: Attach edges to source and target nodes ──────────────────────
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (sourceNode) sourceNode.edges.push(edge);
    // Avoid duplicating the edge on the same node when source === target
    if (targetNode && targetNode !== sourceNode) targetNode.edges.push(edge);
  }

  // ── Step 4: DFS to mark containers and validate tree integrity ───────────
  const visited = new Set<string>();
  for (const root of rootNodes) {
    markContainersRecursive(root, visited);
  }

  return rootNodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively marks `isContainer` on each node that has children.
 * Tracks visited IDs to guard against cycles in malformed input.
 */
function markContainersRecursive(node: ParsedNode, visited: Set<string>): void {
  if (visited.has(node.id)) {
    // Cycle detected — skip to prevent infinite recursion
    return;
  }
  visited.add(node.id);

  for (const child of node.children) {
    markContainersRecursive(child, visited);
  }

  node.isContainer = node.children.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: flatten the tree back to an array (useful for the mapper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performs a depth-first traversal of the resolved node tree and returns
 * every node in a flat array (children included).
 *
 * @param roots - Top-level nodes returned by `resolveHierarchy`
 */
export function flattenTree(roots: ParsedNode[]): ParsedNode[] {
  const result: ParsedNode[] = [];
  const stack: ParsedNode[] = [...roots];

  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node);
    // Push children in reverse so left-most child is processed first
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }

  return result;
}
