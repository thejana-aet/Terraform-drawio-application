/**
 * Draw.io XML Parser
 *
 * Converts a decompressed mxGraphModel XML string into flat arrays of
 * RawNode (vertex) and ParsedEdge (connector) objects.
 *
 * mxCell elements come in three flavours inside Draw.io XML:
 *
 *   1. Root sentinel cells — id="0" and id="1"; always present, contain no
 *      useful data.  We skip these.
 *   2. Vertex cells — have @vertex="1" (or no @edge).  Represent AWS
 *      service icons or container shapes (VPC, Subnet, etc.).
 *   3. Edge cells — have @edge="1" AND @source AND @target attributes.
 *      Represent connections / arrows between services.
 *
 * AWS service key extraction:
 *   Draw.io encodes the icon type in the @style attribute as a semicolon-
 *   separated list of properties.  AWS icon keys always match the pattern
 *   `shape=mxgraph.aws4.<service>` which we extract via regex.
 *
 *   Examples:
 *     "shape=mxgraph.aws4.lambda;..."   → "mxgraph.aws4.lambda"
 *     "shape=mxgraph.aws4.s3;..."       → "mxgraph.aws4.s3"
 *     "whiteSpace=wrap;html=1;"         → "" (no AWS service)
 */

import { parseStringPromise } from 'xml2js';
import { RawNode, ParsedEdge } from '../../types/index';

// Matches "shape=mxgraph.aws4.<service_name>" inside a style string
const AWS_SERVICE_KEY_RE = /shape=(mxgraph\.aws4\.\w+)/i;

interface MxCellAttributes {
  id?: string;
  value?: string;
  style?: string;
  vertex?: string;
  edge?: string;
  source?: string;
  target?: string;
  parent?: string;
}

interface MxCell {
  $: MxCellAttributes;
}

interface MxGeometry {
  $: Record<string, string>;
}

// xml2js parses attributes under the "$" key
interface MxGraphModelXml {
  mxGraphModel: {
    root?: Array<{
      mxCell?: MxCell[];
      // Some Draw.io files nest cells inside UserObject wrappers
      UserObject?: Array<{
        $: { label?: string; id?: string; [key: string]: string | undefined };
        mxCell?: MxCell[];
      }>;
      mxGeometry?: MxGeometry[];
      [key: string]: unknown;
    }>;
  };
}

/**
 * Extracts the AWS service key from a Draw.io style string.
 * Returns an empty string when no AWS icon key is found.
 */
function extractAwsServiceKey(style: string): string {
  const match = AWS_SERVICE_KEY_RE.exec(style);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Parses a decompressed mxGraphModel XML string.
 *
 * @param xml - Valid mxGraphModel XML (output of the decompressor).
 * @returns Object containing flat arrays of raw nodes and edges.
 */
export async function parseDrawioXml(xml: string): Promise<{
  nodes: RawNode[];
  edges: ParsedEdge[];
}> {
  let parsed: MxGraphModelXml;

  try {
    parsed = await parseStringPromise(xml, {
      explicitArray: true,
      mergeAttrs: false,
      trim: true,
    }) as MxGraphModelXml;
  } catch (err) {
    throw new Error(`XML parsing failed: ${(err as Error).message}`);
  }

  const nodes: RawNode[] = [];
  const edges: ParsedEdge[] = [];

  const root = parsed?.mxGraphModel?.root?.[0];
  if (!root) {
    throw new Error('Malformed mxGraphModel: missing root element');
  }

  // ── Process plain mxCell elements ────────────────────────────────────────
  const cells: MxCell[] = root.mxCell ?? [];
  for (const cell of cells) {
    processCell(cell, nodes, edges);
  }

  // ── Process UserObject wrappers (rich labels with custom attributes) ─────
  // Draw.io wraps cells in <UserObject label="..." id="..."> when extra
  // properties are set via "Edit Data".  The child mxCell carries geometry/
  // style; the UserObject carries the label and id.
  const userObjects = root.UserObject ?? [];
  for (const uo of userObjects) {
    const uoAttrs = uo.$;
    const innerCells: MxCell[] = uo.mxCell ?? [];

    for (const inner of innerCells) {
      // Merge UserObject id/label onto the inner cell's attributes
      const merged: MxCell = {
        $: {
          ...inner.$,
          id: uoAttrs.id ?? inner.$.id,
          value: uoAttrs.label ?? inner.$.value,
        },
      };
      processCell(merged, nodes, edges);
    }
  }

  return { nodes, edges };
}

/**
 * Classifies a single mxCell and pushes it into the appropriate output array.
 */
function processCell(cell: MxCell, nodes: RawNode[], edges: ParsedEdge[]): void {
  const a = cell.$;
  if (!a?.id) return;

  // Skip the two Draw.io sentinel root cells
  if (a.id === '0' || a.id === '1') return;

  const isEdge = a.edge === '1' && a.source != null && a.target != null;
  const isVertex = a.vertex === '1';

  if (isEdge) {
    edges.push({
      id: a.id,
      source: a.source!,
      target: a.target!,
      label: a.value?.trim() || undefined,
    });
    return;
  }

  if (isVertex) {
    const style = a.style ?? '';
    nodes.push({
      id: a.id,
      label: a.value?.trim() ?? '',
      style,
      awsServiceKey: extractAwsServiceKey(style),
      parentId: a.parent && a.parent !== '0' && a.parent !== '1'
        ? a.parent
        : null,
    });
  }
  // Cells with neither vertex nor edge flags are skipped (e.g. group cells)
}
