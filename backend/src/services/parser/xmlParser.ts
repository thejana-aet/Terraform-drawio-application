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
import { stripHtml } from '../metadata/metadataExtractor';

// resIcon/icon carry the specific service icon (e.g. resIcon=mxgraph.aws4.ec2).
// shape= is matched last because generic containers use shape=mxgraph.aws4.resourceIcon
// which is not a real resource type.
const AWS_SERVICE_KEY_RES_ICON_RE = /(?:resicon|icon)=(mxgraph\.aws4\.[a-z0-9._-]+)/i;
const AWS_SERVICE_KEY_SHAPE_RE = /shape=(mxgraph\.aws4\.[a-z0-9._-]+)/i;
const AWS_SERVICE_KEY_FALLBACK_RE = /(mxgraph\.aws4\.[a-z0-9._-]+)/i;

// Generic container shape key — not a real resource type; we look past it.
const GENERIC_SHAPE_KEYS = new Set(['mxgraph.aws4.resourceicon', 'mxgraph.aws4.resourceiconsmall']);

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
        $: {
          label?: string;
          value?: string;
          name?: string;
          id?: string;
          style?: string;
          [key: string]: string | undefined;
        };
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
 *
 * Priority order:
 *   1. resIcon= / icon=  — specific service icon (e.g. resIcon=mxgraph.aws4.ec2)
 *   2. shape=            — but only when it is NOT a generic container key
 *   3. Any mxgraph.aws4.* token found anywhere in the style string
 */
function extractAwsServiceKey(style: string): string {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9._]+$/g, '');

  // 1. Prefer resIcon/icon — these always name the actual service.
  const resIconMatch = AWS_SERVICE_KEY_RES_ICON_RE.exec(style);
  if (resIconMatch) return normalise(resIconMatch[1]);

  // 2. shape= — skip generic container shapes like mxgraph.aws4.resourceIcon.
  const shapeMatch = AWS_SERVICE_KEY_SHAPE_RE.exec(style);
  if (shapeMatch) {
    const shapeKey = normalise(shapeMatch[1]);
    if (!GENERIC_SHAPE_KEYS.has(shapeKey)) return shapeKey;
  }

  // 3. Fallback: any mxgraph.aws4.* token (catches unusual encodings).
  const fallback = AWS_SERVICE_KEY_FALLBACK_RE.exec(style);
  if (fallback) return normalise(fallback[1]);

  return '';
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
          value: uoAttrs.label ?? uoAttrs.value ?? uoAttrs.name ?? inner.$.value,
          style: inner.$.style ?? uoAttrs.style ?? '',
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

    // Skip plain text-label cells — Draw.io creates these as children of icon
    // cells to hold the visible label text.  They carry no AWS service key and
    // would be misidentified as duplicate resources by the label-guess logic.
    const styleLow = style.toLowerCase().trimStart();
    if (styleLow.startsWith('text;') || styleLow.startsWith('edgelabel;')) return;

    nodes.push({
      id: a.id,
      label: stripHtml(a.value?.trim() ?? '').trim(),
      style,
      awsServiceKey: extractAwsServiceKey(style),
      parentId: a.parent && a.parent !== '0' && a.parent !== '1'
        ? a.parent
        : null,
    });
  }
  // Cells with neither vertex nor edge flags are skipped (e.g. group cells)
}
