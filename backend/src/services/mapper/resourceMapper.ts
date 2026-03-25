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
  'mxgraph.aws4.nat': 'mxgraph.aws4.nat_gateway',
  'mxgraph.aws4.securitygroup': 'mxgraph.aws4.security_group',
  'mxgraph.aws4.lambda_function': 'mxgraph.aws4.lambda',
  'mxgraph.aws4.bucket': 'mxgraph.aws4.s3',
  'mxgraph.aws4.s3_bucket': 'mxgraph.aws4.s3',
  'mxgraph.aws4.rds_database': 'mxgraph.aws4.rds',
  'mxgraph.aws4.rds_db': 'mxgraph.aws4.rds',
  'mxgraph.aws4.dynamodb_table': 'mxgraph.aws4.dynamodb',
  'mxgraph.aws4.sqs_queue': 'mxgraph.aws4.sqs',
  'mxgraph.aws4.sns_topic': 'mxgraph.aws4.sns',
  'mxgraph.aws4.iam_role': 'mxgraph.aws4.iam_role',
  'mxgraph.aws4.api_gw': 'mxgraph.aws4.api_gateway',
  'mxgraph.aws4.elb': 'mxgraph.aws4.elb',
  'mxgraph.aws4.alb': 'mxgraph.aws4.elb',
  'mxgraph.aws4.ecs_cluster': 'mxgraph.aws4.ecs_service',
  // VPC peering variants
  'mxgraph.aws4.vpc_peering': 'mxgraph.aws4.vpc_peering_connection',
  'mxgraph.aws4.peering': 'mxgraph.aws4.vpc_peering_connection',
  'mxgraph.aws4.vpcpeering': 'mxgraph.aws4.vpc_peering_connection',
  // Transit / VPN gateway variants
  'mxgraph.aws4.transitgateway': 'mxgraph.aws4.transit_gateway',
  'mxgraph.aws4.tgw': 'mxgraph.aws4.transit_gateway',
  'mxgraph.aws4.vpngateway': 'mxgraph.aws4.vpn_gateway',
  'mxgraph.aws4.vpngw': 'mxgraph.aws4.vpn_gateway',
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

function guessAwsServiceKeyFromLabel(label: string): string | null {
  const lower = label.toLowerCase();
  if (!lower.trim()) return null;

  // More-specific patterns MUST come before broader ones (e.g. 'vpc peering'
  // before plain 'vpc') to prevent wrong matches.
  if (lower.includes('internet gateway') || lower.includes('igw')) return 'mxgraph.aws4.internet_gateway';
  if (lower.includes('nat gateway')) return 'mxgraph.aws4.nat_gateway';
  if (lower.includes('transit gateway')) return 'mxgraph.aws4.transit_gateway';
  if (lower.includes('vpn gateway')) return 'mxgraph.aws4.vpn_gateway';
  if (lower.includes('vpc peering') || lower.includes('peering connection')) return 'mxgraph.aws4.vpc_peering_connection';
  if (lower.includes('security group') || lower.includes(' sg ') || lower.endsWith(' sg')) return 'mxgraph.aws4.security_group';
  if (lower.includes('ec2') || lower.includes('instance')) return 'mxgraph.aws4.ec2';
  if (lower.includes('lambda') || lower.includes('function')) return 'mxgraph.aws4.lambda';
  if (lower.includes('s3') || lower.includes('bucket')) return 'mxgraph.aws4.s3';
  if (lower.includes('rds') || lower.includes('db instance')) return 'mxgraph.aws4.rds';
  if (lower.includes('dynamodb')) return 'mxgraph.aws4.dynamodb';
  if (lower.includes('sqs') || lower.includes('queue')) return 'mxgraph.aws4.sqs';
  if (lower.includes('sns') || lower.includes('topic')) return 'mxgraph.aws4.sns';
  if (lower.includes('subnet')) return 'mxgraph.aws4.subnet';
  // 'vpc' comes LAST so 'vpc peering', 'vpn gateway' etc. match first
  if (lower.includes('vpc')) return 'mxgraph.aws4.vpc';

  return null;
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
  // Use ALL tokens together (not any single one) so that multi-token keys like
  // vpc_peering_connection don't accidentally match plain "vpc".
  const leaf = mappingLeaf(key);
  const leafTokens = leaf.split(/[_-]+/g).filter(Boolean);
  const allMappingKeys = Object.keys(awsMappings);

  for (const candidate of allMappingKeys) {
    const candidateLeaf = mappingLeaf(candidate);
    if (candidateLeaf === leaf) return candidate;
    // Only use the token match when ALL tokens from the lookup key are present
    // in the candidate leaf. This stops "vpc" from matching "vpc_peering_connection".
    if (leafTokens.length > 0 && leafTokens.every(t => t.length > 2 && candidateLeaf.includes(t))) return candidate;
  }

  // Last fallback: use resource label hints for common AWS resources.
  // More-specific patterns MUST come before broader ones.
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes('ec2')) return 'mxgraph.aws4.ec2';
  if (lowerLabel.includes('internet gateway') || lowerLabel.includes('igw')) return 'mxgraph.aws4.internet_gateway';
  if (lowerLabel.includes('nat gateway')) return 'mxgraph.aws4.nat_gateway';
  if (lowerLabel.includes('transit gateway')) return 'mxgraph.aws4.transit_gateway';
  if (lowerLabel.includes('vpn gateway')) return 'mxgraph.aws4.vpn_gateway';
  if (lowerLabel.includes('vpc peering') || lowerLabel.includes('peering connection')) return 'mxgraph.aws4.vpc_peering_connection';
  if (lowerLabel.includes('security group')) return 'mxgraph.aws4.security_group';
  if (lowerLabel.includes('subnet')) return 'mxgraph.aws4.subnet';
  if (lowerLabel.includes('lambda') || lowerLabel.includes('function')) return 'mxgraph.aws4.lambda';
  if (lowerLabel.includes('s3') || lowerLabel.includes('bucket') || lowerLabel.includes('storage')) return 'mxgraph.aws4.s3';
  if (lowerLabel.includes('rds') || lowerLabel.includes('database') || lowerLabel.includes('db instance')) return 'mxgraph.aws4.rds';
  if (lowerLabel.includes('dynamodb') || lowerLabel.includes('nosql')) return 'mxgraph.aws4.dynamodb';
  if (lowerLabel.includes('sqs') || lowerLabel.includes('queue')) return 'mxgraph.aws4.sqs';
  if (lowerLabel.includes('sns') || lowerLabel.includes('topic')) return 'mxgraph.aws4.sns';
  if (lowerLabel.includes('iam') || lowerLabel.includes('role')) return 'mxgraph.aws4.iam_role';
  if (lowerLabel.includes('api gateway')) return 'mxgraph.aws4.api_gateway';
  if (lowerLabel.includes('cloudfront') || lowerLabel.includes('cdn')) return 'mxgraph.aws4.cloudfront';
  if (lowerLabel.includes('alb') || lowerLabel.includes('load balancer')) return 'mxgraph.aws4.elb';
  if (lowerLabel.includes('ecs') || lowerLabel.includes('container')) return 'mxgraph.aws4.ecs_service';
  if (lowerLabel.includes('eks') || lowerLabel.includes('kubernetes')) return 'mxgraph.aws4.eks';
  // 'vpc' comes LAST so 'vpc peering', 'vpn gateway' etc. match first
  if (lowerLabel.includes('vpc')) return 'mxgraph.aws4.vpc';

  return null;
}

/**
 * Resolves conflicts between an icon-derived key and an explicit label hint.
 *
 * Some Draw.io diagrams use generic/group visuals or mis-typed AWS icons while
 * the label is explicit (e.g. "Private Subnet"). In those cases, prefer the
 * canonical AWS key that matches the label so generated Terraform matches docs.
 */
function resolveLabelConflictKey(resolvedKey: string, label: string): string {
  const lower = label.toLowerCase();
  if (!lower.trim()) return resolvedKey;

  const saysSubnet = lower.includes('subnet');
  const saysSecurityGroup = lower.includes('security group') || /\bsg\b/.test(lower);
  const saysVpc = /\bvpc\b/.test(lower) && !lower.includes('vpc peering');

  // Label explicitly says subnet: prefer subnet over generic/group/sg misreads.
  if (
    saysSubnet &&
    resolvedKey !== 'mxgraph.aws4.subnet' &&
    ['mxgraph.aws4.group', 'mxgraph.aws4.security_group', 'mxgraph.aws4.vpc'].includes(resolvedKey)
  ) {
    return 'mxgraph.aws4.subnet';
  }

  // Label explicitly says security group: prefer SG over generic/group.
  if (
    saysSecurityGroup &&
    resolvedKey !== 'mxgraph.aws4.security_group' &&
    ['mxgraph.aws4.group', 'mxgraph.aws4.vpc'].includes(resolvedKey)
  ) {
    return 'mxgraph.aws4.security_group';
  }

  // Label explicitly says VPC: prefer VPC over generic/group.
  if (
    saysVpc &&
    resolvedKey !== 'mxgraph.aws4.vpc' &&
    resolvedKey === 'mxgraph.aws4.group'
  ) {
    return 'mxgraph.aws4.vpc';
  }

  return resolvedKey;
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

  // Skip pure diagram decoration containers — not real AWS resources
  if (
    combined.includes('aws cloud') ||
    combined.includes('aws account') ||
    combined.includes('availability zone') ||
    combined.includes('availability_zone') ||
    /\bregion\b/.test(combined) ||
    /\baccount\b/.test(combined)
  ) {
    return null;
  }

  // More-specific checks first — vpc peering before plain vpc
  if (combined.includes('vpc peering') || combined.includes('peering connection')) {
    return 'aws_vpc_peering_connection';
  }

  // Detect security groups
  if (combined.includes('security group') || / sg$/.test(lowerLabel) || / sg /.test(lowerLabel)) {
    return 'aws_security_group';
  }

  // Detect subnets
  if (combined.includes('subnet')) {
    return 'aws_subnet';
  }

  // Detect VPCs — only when the label explicitly says "vpc" and is a real VPC container
  if (combined.includes('vpc')) {
    return 'aws_vpc';
  }

  // Unknown generic container — skip rather than guess
  return null;
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

  // Build a quick lookup so we can check whether a node's parent is already
  // a recognised AWS resource icon.  Used to skip label-only child cells.
  const nodeMap = new Map<string, ParsedNode>(nodes.map(n => [n.id, n]));

  for (const node of nodes) {
    const guessedAwsKey = !node.awsServiceKey
      ? guessAwsServiceKeyFromLabel(node.label)
      : null;
    const effectiveAwsServiceKey = node.awsServiceKey || guessedAwsKey || '';

    // If this node has no AWS key from its style and we are about to rely
    // purely on a label guess, check whether its parent already has an AWS
    // service key.  If so, this cell is a text-label child attached to the
    // parent icon — skip it to avoid creating a duplicate resource.
    if (!node.awsServiceKey && guessedAwsKey && node.parentId) {
      const parentNode = nodeMap.get(node.parentId);
      if (parentNode?.awsServiceKey) continue;
    }

    if (!effectiveAwsServiceKey) {
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

    const resolvedKey = resolveMappingKey(effectiveAwsServiceKey, node.label || '');
    if (!resolvedKey) {
      warnings.push(
        `No Terraform mapping found for AWS icon key "${effectiveAwsServiceKey}" ` +
        `(node: "${node.label || node.id}"). Skipping.`
      );
      continue;
    }
    const canonicalKey = resolveLabelConflictKey(resolvedKey, node.label || '');
    const mapping = awsMappings[canonicalKey];

    // Build resource name
    const labelName = extractResourceName(node.label);
    const serviceLeaf = canonicalKey.split('.').pop() ?? 'resource';
    const baseName = sanitiseName(labelName, serviceLeaf);

    // For generic group shapes, intelligently detect the actual resource type
    let terraformType = mapping.terraformType;
    if (canonicalKey === 'mxgraph.aws4.group') {
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

  // ── Post-pass: wire subnet_id / vpc_id from Draw.io containment ──────────
  // nodeMap and knownIds are already built above — reuse them here.
  const nodeIdToResource = new Map<string, MappedResource>(
    resources.map(r => [r.node.id, r])
  );

  /**
   * Walks the parentId chain from `startId` and returns the first
   * MappedResource whose terraformType matches `targetType`.
   */
  function findAncestor(startId: string | null, targetType: string): MappedResource | null {
    let currentId = startId;
    while (currentId !== null) {
      const res = nodeIdToResource.get(currentId);
      if (res && res.terraformType === targetType) return res;
      const n = nodeMap.get(currentId);
      if (!n) break;
      currentId = n.parentId;
    }
    return null;
  }

  for (const resource of resources) {
    const { terraformType, arguments: args, node } = resource;

    // ── subnet_id: EC2 / NAT Gateway inside a subnet ─────────────────────
    if (
      ['aws_instance', 'aws_nat_gateway', 'aws_network_interface'].includes(terraformType) &&
      !('subnet_id' in args)
    ) {
      const subnetRes = findAncestor(node.parentId, 'aws_subnet');
      if (subnetRes) {
        args['subnet_id'] = `aws_subnet.${subnetRes.resourceName}.id`;
        // Ensure the subnet is in the dependency list
        if (!resource.dependencies.includes(subnetRes.node.id)) {
          resource.dependencies.push(subnetRes.node.id);
        }
      }
    }

    // ── vpc_id (subnet): Subnet inside a VPC ─────────────────────────────
    if (terraformType === 'aws_subnet') {
      const vpcRes = findAncestor(node.parentId, 'aws_vpc');
      if (vpcRes) {
        args['vpc_id'] = `aws_vpc.${vpcRes.resourceName}.id`;
        if (!resource.dependencies.includes(vpcRes.node.id)) {
          resource.dependencies.push(vpcRes.node.id);
        }
      }
    }

    // ── vpc_id (security group): SG inside a VPC (possibly via subnet) ───
    if (terraformType === 'aws_security_group' && (!('vpc_id' in args) || args['vpc_id']?.startsWith('var.'))) {
      const vpcRes =
        findAncestor(node.parentId, 'aws_vpc') ??
        // also check grandparent (SG drawn inside a subnet that's inside VPC)
        findAncestor(nodeMap.get(node.parentId ?? '')?.parentId ?? null, 'aws_vpc');
      if (vpcRes) {
        args['vpc_id'] = `aws_vpc.${vpcRes.resourceName}.id`;
        if (!resource.dependencies.includes(vpcRes.node.id)) {
          resource.dependencies.push(vpcRes.node.id);
        }
      }
    }

    // ── vpc_id (internet gateway / NAT): IGW attached to VPC ─────────────
    if (
      ['aws_internet_gateway', 'aws_vpn_gateway'].includes(terraformType) &&
      !('vpc_id' in args)
    ) {
      const vpcRes = findAncestor(node.parentId, 'aws_vpc');
      if (vpcRes) {
        args['vpc_id'] = `aws_vpc.${vpcRes.resourceName}.id`;
        if (!resource.dependencies.includes(vpcRes.node.id)) {
          resource.dependencies.push(vpcRes.node.id);
        }
      }
    }
  }

  return { resources, warnings };
}
