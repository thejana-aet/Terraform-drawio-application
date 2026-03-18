/**
 * Ingestion Engine — Draw.io XML Decompressor
 *
 * Draw.io files can store their diagram content in two formats:
 *
 *   1. Plain XML  — the <mxGraphModel> element is directly inside the <diagram> tag
 *   2. Compressed — the <diagram> content is a Base64-encoded, pako-deflated,
 *                   URL-encoded string. This is the default when "Compress XML"
 *                   is enabled in Draw.io (which is the default setting).
 *
 * Decompression pipeline:
 *   raw string
 *     → URL-decode  (decodeURIComponent)
 *     → Base64 decode (Buffer.from(..., 'base64'))
 *     → pako.inflateRaw (Deflate algorithm without zlib header/trailer)
 *     → UTF-8 string
 *     → valid mxGraphModel XML
 */

import pako from 'pako';

const MXGRAPH_MODEL_TAG = '<mxGraphModel';

/**
 * Returns `true` when `content` is already a plain XML string containing
 * an mxGraphModel element (i.e. no decompression is needed).
 */
function isPlainXml(content: string): boolean {
  return content.trimStart().startsWith('<') && content.includes(MXGRAPH_MODEL_TAG);
}

/**
 * Attempts to decompress a single Draw.io diagram payload.
 *
 * @param content - Raw string value of the `<diagram>` element.  This may be
 *                  either plain XML or a compressed+encoded blob.
 * @returns Decompressed mxGraphModel XML string.
 * @throws {Error} When decompression fails or the resulting string does not
 *                 contain an expected mxGraphModel element.
 */
export function decompressDiagram(content: string): string {
  const trimmed = content.trim();

  // Fast path — already plain XML
  if (isPlainXml(trimmed)) {
    return trimmed;
  }

  // Compressed path: URL-decode → Base64-decode → inflateRaw → UTF-8
  let urlDecoded: string;
  try {
    urlDecoded = decodeURIComponent(trimmed);
  } catch {
    // Content may already be plain Base64 without URL encoding
    urlDecoded = trimmed;
  }

  let binaryData: Uint8Array;
  try {
    const binaryString = Buffer.from(urlDecoded, 'base64');
    binaryData = new Uint8Array(binaryString);
  } catch (err) {
    throw new Error(`Base64 decoding failed: ${(err as Error).message}`);
  }

  let decompressed: string;
  try {
    // Draw.io uses raw Deflate (no zlib header), so we use inflateRaw
    const inflated = pako.inflateRaw(binaryData, { to: 'string' });
    decompressed = inflated;
  } catch (err) {
    throw new Error(
      `Deflate decompression failed. The diagram content may be corrupted or in an unsupported format. ` +
      `Details: ${(err as Error).message}`
    );
  }

  if (!decompressed.includes(MXGRAPH_MODEL_TAG)) {
    throw new Error(
      `Decompression produced unexpected output. Expected mxGraphModel XML but got: ` +
      `${decompressed.slice(0, 120)}...`
    );
  }

  return decompressed;
}

/**
 * Extracts and decompresses all `<diagram>` elements found in a .drawio
 * file string (a .drawio file is a `<mxfile>` wrapper that can contain
 * multiple pages, each as a `<diagram>` element).
 *
 * @param drawioFileContent - Full text content of a .drawio file.
 * @returns Array of decompressed mxGraphModel XML strings, one per page.
 * @throws {Error} When no diagram elements are found.
 */
export function extractDiagrams(drawioFileContent: string): string[] {
  // Match all <diagram ...>...</diagram> blocks (including multi-line content)
  const diagramPattern = /<diagram[^>]*>([\s\S]*?)<\/diagram>/gi;
  const diagrams: string[] = [];

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = diagramPattern.exec(drawioFileContent)) !== null) {
    const innerContent = match[1].trim();
    if (innerContent.length === 0) continue;
    diagrams.push(decompressDiagram(innerContent));
  }

  if (diagrams.length === 0) {
    // The file itself might be a bare mxGraphModel without a wrapper
    if (drawioFileContent.includes(MXGRAPH_MODEL_TAG)) {
      return [drawioFileContent.trim()];
    }
    throw new Error(
      'No <diagram> elements found in the provided file. ' +
      'Ensure the file is a valid .drawio (mxfile) document.'
    );
  }

  return diagrams;
}
