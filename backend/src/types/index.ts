// ────────────────────────────────────────────────────────────
// Raw Draw.io parse output (before hierarchy resolution)
// ────────────────────────────────────────────────────────────

/**
 * A raw vertex cell extracted directly from an mxCell element.
 * Children are not yet resolved at this stage.
 */
export interface RawNode {
  /** mxCell @id attribute */
  id: string;
  /** mxCell @value (label text, may contain "Key: value" pairs) */
  label: string;
  /** mxCell @style attribute string */
  style: string;
  /**
   * The first matching AWS icon prefix extracted from `style`.
   * e.g. "mxgraph.aws4.lambda", "mxgraph.aws4.s3"
   * Empty string when no AWS service key is found.
   */
  awsServiceKey: string;
  /** mxCell @parent attribute – Draw.io cell ID of the parent container */
  parentId: string | null;
}

// ────────────────────────────────────────────────────────────
// Resolved node tree
// ────────────────────────────────────────────────────────────

/**
 * A directed connection between two vertices.
 */
export interface ParsedEdge {
  id: string;
  source: string;
  target: string;
  /** Optional label on the connector */
  label?: string;
}

/**
 * A fully resolved vertex with its hierarchy and metadata.
 * Built by the HierarchyResolver after the initial XML parse.
 */
export interface ParsedNode {
  id: string;
  label: string;
  style: string;
  /** First AWS icon key extracted from `style`, or "" if unknown */
  awsServiceKey: string;
  /** Parent cell ID, null when this is a root-level node */
  parentId: string | null;
  /** Direct child nodes (e.g. EC2 instances inside a Subnet) */
  children: ParsedNode[];
  /** Edges where this node is either the source or the target */
  edges: ParsedEdge[];
  /** Key-value pairs extracted from `label` ("InstanceType: t3.micro" → { InstanceType: "t3.micro" }) */
  metadata: Record<string, string>;
  /** true when this node has at least one child (i.e. acts as a container) */
  isContainer: boolean;
}

// ────────────────────────────────────────────────────────────
// Mapping table (awsMappings.json schema)
// ────────────────────────────────────────────────────────────

/**
 * Describes how an AWS Draw.io icon maps to a Terraform resource type.
 */
export interface AwsMapping {
  /** Terraform resource type, e.g. "aws_lambda_function" */
  terraformType: string;
  /** Argument names that MUST be present in the generated resource block */
  requiredArgs: string[];
  /** Sensible default values for common arguments */
  defaults: Record<string, string>;
}

/**
 * The full shape of awsMappings.json.
 * Key = mxgraph style key, e.g. "mxgraph.aws4.lambda"
 */
export type AwsMappingTable = Record<string, AwsMapping>;

// ────────────────────────────────────────────────────────────
// Mapped resource (output of resourceMapper)
// ────────────────────────────────────────────────────────────

/**
 * A Terraform resource ready to be serialised into HCL.
 */
export interface MappedResource {
  /** Terraform resource type, e.g. "aws_lambda_function" */
  terraformType: string;
  /**
   * Sanitised snake_case resource name derived from the node label.
   * Used as the second label in the HCL `resource "<type>" "<name>"` block.
   */
  resourceName: string;
  /**
   * Key-value pairs to emit as HCL argument assignments.
   * Values are raw strings; the generator wraps them in quotes as needed.
   */
  arguments: Record<string, string>;
  /**
   * IDs of other ParsedNodes (not resource names) that this resource
   * depends on, derived from edges and parent-container relationships.
   */
  dependencies: string[];
  /** Back-reference to the originating node */
  node: ParsedNode;
}

// ────────────────────────────────────────────────────────────
// Conversion pipeline result
// ────────────────────────────────────────────────────────────

export interface ConversionResult {
  resources: MappedResource[];
  /** Non-fatal issues (e.g. unrecognised icon styles) */
  warnings: string[];
}

// ────────────────────────────────────────────────────────────
// API response shapes (shared with frontend if needed)
// ────────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
  details?: string;
}

export interface PreviewResource {
  type: string;
  name: string;
  label: string;
}

export interface PreviewResponse {
  success: true;
  resources: PreviewResource[];
  files: Record<string, string>;
  warnings: string[];
}
