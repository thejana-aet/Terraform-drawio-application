/**
 * Metadata Extractor
 *
 * Draw.io allows users to annotate icon labels with arbitrary key-value pairs
 * using a simple `Key: Value` convention (one pair per line).  This module
 * parses those pairs out of a node's label text and returns them as a plain
 * JavaScript object that the resource mapper can merge into HCL arguments.
 *
 * Supported label formats
 * ───────────────────────
 *
 * Plain name (no pairs):
 *   "My Lambda Function"           →  {}
 *
 * Single pair:
 *   "Runtime: nodejs20.x"          →  { Runtime: "nodejs20.x" }
 *
 * Multiple pairs (rest of label is the name):
 *   "web-server\nInstanceType: t3.micro\nAMI: ami-0abcdef1234567890"
 *                                  →  { InstanceType: "t3.micro", AMI: "ami-0abcdef1234567890" }
 *
 * HTML labels (Draw.io wraps labels in <div> / <br> tags):
 *   "<b>My DB</b><br>Engine: mysql<br>Version: 8.0"
 *                                  →  { Engine: "mysql", Version: "8.0" }
 *
 * Key rules
 * ─────────
 * - Keys start with a letter and contain only word characters and spaces.
 * - The colon separator may have surrounding whitespace.
 * - Values extend to the end of the line (after trimming).
 * - Duplicate keys: last value wins.
 */

/** Strips HTML tags and decodes common HTML entities */
function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')    // <br> and <br/> → newline
    .replace(/<[^>]+>/g, '')           // remove all other tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Matches lines of the form "KeyName: value" (key may contain spaces)
const KV_LINE_RE = /^([\w][\w\s]{0,48}):\s*(.+)$/;

/**
 * Extracts key-value metadata from a Draw.io node label.
 *
 * @param label - Raw label text (may contain HTML and/or newlines)
 * @returns      A record of extracted key-value pairs.
 *               Returns an empty object when no pairs are found.
 */
export function extractMetadata(label: string): Record<string, string> {
  if (!label || label.trim().length === 0) return {};

  const plain = stripHtml(label);
  const result: Record<string, string> = {};

  for (const line of plain.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = KV_LINE_RE.exec(trimmed);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extracts the "name" portion of a label — all lines that are NOT key-value
 * pairs.  Useful for deriving the Terraform resource name.
 *
 * @param label - Raw label text
 * @returns      Non-pair lines joined by spaces, or empty string.
 */
export function extractResourceName(label: string): string {
  if (!label || label.trim().length === 0) return '';

  const plain = stripHtml(label);
  const nameParts: string[] = [];

  for (const line of plain.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!KV_LINE_RE.test(trimmed)) {
      nameParts.push(trimmed);
    }
  }

  return nameParts.join(' ').trim();
}
