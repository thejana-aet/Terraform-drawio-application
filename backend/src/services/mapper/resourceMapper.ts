/**
 * Resource Mapper
 *
 * Converts a flat list of resolved ParsedNodes into MappedResource objects
 * that carry all information needed by the HCL generator:
 *
 *   - terraformType  — from awsMappings.json lookup
 *   - resourceName   — sanitised snake_case identifier derived from the label
 *   - arguments      — merged from mapping defaults + extracted metadata
 *   - dependencies   — other resource IDs inferred from edges + parent container
 *
 * Nodes whose awsServiceKey is not found in awsMappings.json produce a
 * warning and are skipped rather than causing a hard error.
 *
 * Name sanitisation rules
 * ───────────────────────
 * Terraform identifiers must start with a letter and contain only letters,
 * digits and underscores.  We:
 *   1. Take the "name" portion of the label (non-KV lines) or fall back to
 *      the awsServiceKey leaf (e.g. "lambda" from "mxgraph.aws4.lambda").
 *   2. Lower-case everything.
 *   3. Replace spaces and hyphens with underscores.
 *   4. Strip any remaining non-word characters.
 *   5. Collapse consecutive underscores.
 *   6. Ensure the result starts with a letter; prefix "res_" otherwise.
 *   7. Truncate to 64 characters.
 *   8. De-duplicate: append _2, _3, … for collisions.
 *
 * Argument key normalisation
 * ──────────────────────────
 * Metadata keys extracted from labels may have mixed case or spaces
 * ("InstanceType", "instance type", "instance_type").  We normalise them to
 * snake_case before merging so they produce valid HCL argument names.
 */

import { ParsedNode, MappedResource, ConversionResult, AwsMappingTable } from '../../types/index';
import { extractResourceName } from '../metadata/metadataExtractor';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const awsMappings = require('./awsMappings.json') as AwsMappingTable;

const KEY_ALIASES: Record<string, string> = {
  'mxgraph.aws4.ec2_instance': 'mxgraph.aws4.ec2',
  'mxgraph.aws4.compute.ec2': 'mxgraph.aws4.ec2',
  'mxgraph.aws4.compute.ec2_instance': 'mxgraph.aws4.ec2',
  'mxgraph.aws4.instance_ec2': 'mxgraph.aws4.ec2',
  'mxgraph.aws4.igw': 'mxgraph.aws4.internet_gateway',
  'mxgraph.aws4.internetgateway': 'mxgraph.aws4.internet_gateway',
  'mxgraph.aws4.natgateway': 'mxgraph.aws4.nat_gateway',
  'mxgraph.aws4.securitygroup': 'mxgraph.aws4.security_group',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a human-readable string into a valid Terraform resource name.
 */
function sanitiseName(raw: string, fallback: string): string {
  const source = raw.trim().length > 0 ? raw : fallback;
  let name = source
    .toLowerCase()
    .replace(/[\s-]+/g, '_')   // spaces/hyphens → underscore
    .replace(/[^\w]/g, '')      // strip non-word chars (keeps letters, digits, _)
    .replace(/_+/g, '_')        // collapse consecutive underscores
    .replace(/^_+|_+$/g, '');   // trim leading/trailing underscores

  if (!name || !/^[a-z]/.test(name)) {
    name = `res_${name || 'unknown'}`;
  }

  return name.slice(0, 64);
}

/**
 * Normalises a metadata key to snake_case.
 * "InstanceType" → "instance_type", "my-key name" → "my_key_name"
 */
function toSnakeCase(key: string): string {
  return key
    // Insert underscore before uppercase letters that follow lowercase (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Derives dependency resource IDs from a node's edges and its parent.
 * Only IDs that appear in the known nodeId set are included.
 */
function resolveDependencies(node: ParsedNode, knownIds: Set<string>): string[] {
  const deps = new Set<string>();

  for (const edge of node.edges) {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    if (knownIds.has(otherId) && otherId !== node.id) {
      deps.add(otherId);
    }
  }

  if (node.parentId && knownIds.has(node.parentId)) {
    deps.add(node.parentId);
  }

  return [...deps];
}

function mappingLeaf(key: string): string {
  return key.split('.').pop() ?? key;
}

function resolveMappingKey(awsServiceKey: string, label: string): string | null {
  const key = awsServiceKey.toLowerCase();

  if (awsMappings[key]) return key;
  if (KEY_ALIASES[key] && awsMappings[KEY_ALIASES[key]]) return KEY_ALIASES[key];

  // Try stripping extra segments from right to left:
  // mxgraph.aws4.compute.ec2_instance -> mxgraph.aws4.compute -> mxgraph.aws4
  const parts = key.split('.');
  for (let i = parts.length - 1; i > 2; i--) {
    const candidate = parts.slice(0, i).join('.');
    if (awsMappings[candidate]) return candidate;
  }

  // Try leaf-based fuzzy match: ec2_instance -> ec2 / instance
  const leaf = mappingLeaf(key);
  const leafTokens = leaf.split(/[_-]+/g).filter(Boolean);
  const allMappingKeys = Object.keys(awsMappings);

  for (const candidate of allMappingKeys) {
    const candidateLeaf = mappingLeaf(candidate);
    if (candidateLeaf === leaf) return candidate;
    if (leafTokens.some(t => t.length > 2 && candidateLeaf.includes(t))) return candidate;
  }

  // Last fallback: use resource label hints for common AWS resources.
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes('ec2')) return 'mxgraph.aws4.ec2';
  if (lowerLabel.includes('internet gateway') || lowerLabel.includes('igw')) return 'mxgraph.aws4.internet_gateway';
  if (lowerLabel.includes('nat gateway')) return 'mxgraph.aws4.nat_gateway';
  if (lowerLabel.includes('security group')) return 'mxgraph.aws4.security_group';
  if (lowerLabel.includes('subnet')) return 'mxgraph.aws4.subnet';
  if (lowerLabel.includes('vpc')) return 'mxgraph.aws4.vpc';

  return null;
}

/**
 * Detects the specific resource type for generic "group" shapes by analyzing   * the label, metadata, and naming patterns.
 * 
 * Examples:
 *   "Private Subnet" → "aws_subnet"
 *   "Web Security Group" → "aws_security_group"
 *   "Development VPC" → "aws_vpc"
 *   "AWS Cloud" → null (skip - just a container)
 */
function detectGroupResourceType(label: string, metadata: Record<string, string>): string | null {
  const lowerLabel = label.toLowerCase();
  const lowerMeta = JSON.stringify(metadata).toLowerCase();
  const combined = `${lowerLabel} ${lowerMeta}`;

  // Skip container elements that aren't actual resources
  if (combined.includes('aws cloud') || combined.includes('region') || combined.includes('account')) {
    return null;
  }

  // Detect security groups
  if (combined.includes('security group') || combined.includes('sg')) {
    return 'aws_security_group';
  }

  // Detect subnets
  if (combined.includes('subnet')) {
    return 'aws_subnet';
  }

  // Detect VPCs
  if (combined.includes('vpc')) {
    return 'aws_vpc';
  }

  // Default to VPC for other generic containers
  return 'aws_vpc';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an array of resolved ParsedNodes to MappedResource objects.
 *
 * @param nodes - Flat node list (output of `flattenTree`)
 * @returns      ConversionResult with mapped resources and any warnings
 */
export function mapResources(nodes: ParsedNode[]): ConversionResult {
  const warnings: string[] = [];
  const resources: MappedResource[] = [];
  const usedNames = new Map<string, number>(); // name → occurrence count
  const knownIds = new Set(nodes.map(n => n.id));

  for (const node of nodes) {
    if (!node.awsServiceKey) {
      // Container shapes (VPC, Subnet drawn as rectangles) may have no AWS key
      // but still be valid resources.  Only warn when the style has some content.
      if (node.style.trim().length > 0 && !node.isContainer) {
        warnings.push(
          `Node "${node.label || node.id}" has an unrecognised style and was skipped. ` +
          `Style: ${node.style.slice(0, 80)}`
        );
      }
      continue;
    }

    const resolvedKey = resolveMappingKey(node.awsServiceKey, node.label || '');
    if (!resolvedKey) {
      warnings.push(
        `No Terraform mapping found for AWS icon key "${node.awsServiceKey}" ` +
        `(node: "${node.label || node.id}"). Skipping.`
      );
      continue;
    }
    const mapping = awsMappings[resolvedKey];

    // Build resource name
    const labelName = extractResourceName(node.label);
    const serviceLeaf = resolvedKey.split('.').pop() ?? 'resource';
    const baseName = sanitiseName(labelName, serviceLeaf);

    // For generic group shapes, intelligently detect the actual resource type
    let terraformType = mapping.terraformType;
    if (resolvedKey === 'mxgraph.aws4.group') {
      const detectedType = detectGroupResourceType(node.label, node.metadata);
      if (!detectedType) {
        // Skip container elements that aren't resources (AWS Cloud, Region, etc.)
        continue;
      }
      terraformType = detectedType;
    }

    // De-duplicate names within this conversion run
    const count = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, count + 1);
    const resourceName = count === 0 ? baseName : `${baseName}_${count + 1}`;

    // Merge arguments: mapping defaults ← metadata (user values win)
    const normalisedMeta: Record<string, string> = {};
    for (const [key, val] of Object.entries(node.metadata)) {
      normalisedMeta[toSnakeCase(key)] = val;
    }
    const args: Record<string, string> = {
      ...mapping.defaults,
      ...normalisedMeta,
    };

    // Ensure vpc_id / cidr_block for subnets, cidr_block for VPCs, etc.
    if (terraformType === 'aws_subnet' && 'cidr_block' in args === false) {
      args['cidr_block'] = 'var.subnet_cidr_block';
    }
    if (terraformType === 'aws_subnet' && 'vpc_id' in args === false) {
      args['vpc_id'] = 'var.vpc_id';
    }
    if (terraformType === 'aws_vpc' && 'cidr_block' in args === false) {
      args['cidr_block'] = '10.0.0.0/16';
    }
    if (terraformType === 'aws_security_group' && 'vpc_id' in args === false) {
      args['vpc_id'] = 'var.vpc_id';
    }

    // Ensure function_name / name / identifier / cluster_id gets the resource name
    // when the user hasn't explicitly provided it
    if ('function_name' in args === false && terraformType === 'aws_lambda_function') {
      args['function_name'] = resourceName;
    }
    if ('name' in args === false && [
      'aws_s3_bucket', 'aws_sqs_queue', 'aws_sns_topic', 'aws_iam_role',
      'aws_api_gateway_rest_api', 'aws_apigatewayv2_api', 'aws_dynamodb_table',
      'aws_ecs_cluster', 'aws_eks_cluster', 'aws_lb', 'aws_security_group',
      'aws_cloudwatch_log_group', 'aws_kinesis_stream', 'aws_secretsmanager_secret',
    ].includes(terraformType)) {
      args['name'] = resourceName;
    }
    if ('bucket' in args === false && terraformType === 'aws_s3_bucket') {
      args['bucket'] = resourceName;
    }
    if ('identifier' in args === false && terraformType === 'aws_db_instance') {
      args['identifier'] = resourceName;
    }
    if ('cluster_id' in args === false && terraformType === 'aws_elasticache_cluster') {
      args['cluster_id'] = resourceName;
    }

    resources.push({
      terraformType,
      resourceName,
      arguments: args,
      dependencies: resolveDependencies(node, knownIds),
      node,
    });
  }

  return { resources, warnings };
}
