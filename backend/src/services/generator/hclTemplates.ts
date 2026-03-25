/**
 * HCL Template Generator
 *
 * Builds the three Terraform source files from a list of MappedResources:
 *
 *   providers.tf  — required_providers block + provider "aws" config
 *   variables.tf  — input variables (aws_region + any resource-specific vars)
 *   main.tf       — one `resource` block per MappedResource, ordered the way
 *                   a real DevOps engineer would write them (networking first,
 *                   then IAM, storage, compute, databases, serverless, etc.)
 *                   with topological ordering within each tier.
 *
 * HCL value quoting rules applied here
 * ─────────────────────────────────────
 *  • Values that are already a Terraform expression (reference another resource,
 *    start with "var.", "aws_", "data.", contain dots, or are "true"/"false")
 *    are emitted without quotes.
 *  • Pure integer strings are emitted without quotes.
 *  • Everything else is wrapped in double-quotes.
 */

import { MappedResource } from '../../types/index';

// ─────────────────────────────────────────────────────────────────────────────
// DevOps resource ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tiers define the deployment order a real DevOps engineer follows:
 *
 *  1  Networking foundation  — VPC, Internet Gateway, NAT, subnets, route tables
 *  2  Security              — Security groups, NACLs, WAF
 *  3  IAM                   — Roles, policies, instance profiles
 *  4  Storage               — S3, DynamoDB, EFS
 *  5  Compute               — EC2 instances, launch templates, auto-scaling
 *  6  Load balancers        — ALB / NLB / CLB
 *  7  Containers            — ECS clusters/services, EKS
 *  8  Serverless            — Lambda, API Gateway, CloudFront
 *  9  Databases             — RDS, Aurora, ElastiCache, Redshift
 * 10  Messaging             — SQS, SNS, Kinesis, EventBridge
 * 11  Monitoring / Other    — CloudWatch, Secrets Manager, everything else
 */
const DEVOPS_TIERS: Record<string, number> = {
  // Tier 1 — Networking
  aws_vpc:                        1,
  aws_internet_gateway:           1,
  aws_nat_gateway:                1,
  aws_eip:                        1,
  aws_subnet:                     1,
  aws_route_table:                1,
  aws_route:                      1,
  aws_route_table_association:    1,
  aws_vpc_peering_connection:     1,
  aws_vpn_gateway:                1,
  aws_dx_gateway:                 1,

  // Tier 2 — Security / Firewall
  aws_security_group:             2,
  aws_security_group_rule:        2,
  aws_network_acl:                2,
  aws_network_acl_rule:           2,
  aws_wafv2_web_acl:              2,
  aws_shield_protection:          2,

  // Tier 3 — IAM
  aws_iam_role:                   3,
  aws_iam_policy:                 3,
  aws_iam_role_policy:            3,
  aws_iam_role_policy_attachment: 3,
  aws_iam_instance_profile:       3,
  aws_iam_user:                   3,
  aws_iam_group:                  3,

  // Tier 4 — Storage
  aws_s3_bucket:                  4,
  aws_s3_bucket_policy:           4,
  aws_s3_bucket_acl:              4,
  aws_dynamodb_table:             4,
  aws_efs_file_system:            4,
  aws_efs_mount_target:           4,

  // Tier 5 — Compute
  aws_instance:                   5,
  aws_key_pair:                   5,
  aws_launch_template:            5,
  aws_autoscaling_group:          5,
  aws_placement_group:            5,

  // Tier 6 — Load Balancers
  aws_lb:                         6,
  aws_alb:                        6,
  aws_lb_listener:                6,
  aws_lb_target_group:            6,
  aws_lb_target_group_attachment: 6,
  aws_alb_listener:               6,
  aws_alb_target_group:          6,
  aws_elb:                        6,

  // Tier 7 — Containers
  aws_ecs_cluster:                7,
  aws_ecs_task_definition:        7,
  aws_ecs_service:                7,
  aws_eks_cluster:                7,
  aws_eks_node_group:             7,

  // Tier 8 — Serverless & CDN
  aws_lambda_function:            8,
  aws_lambda_permission:          8,
  aws_lambda_event_source_mapping: 8,
  aws_api_gateway_rest_api:       8,
  aws_api_gateway_resource:       8,
  aws_api_gateway_method:         8,
  aws_api_gateway_integration:    8,
  aws_apigatewayv2_api:           8,
  aws_apigatewayv2_stage:         8,
  aws_cloudfront_distribution:    8,

  // Tier 9 — Databases
  aws_db_instance:                9,
  aws_db_subnet_group:            9,
  aws_db_parameter_group:         9,
  aws_rds_cluster:                9,
  aws_rds_cluster_instance:       9,
  aws_elasticache_cluster:        9,
  aws_elasticache_subnet_group:   9,
  aws_elasticache_replication_group: 9,
  aws_redshift_cluster:           9,

  // Tier 10 — Messaging & Eventing
  aws_sqs_queue:                  10,
  aws_sqs_queue_policy:           10,
  aws_sns_topic:                  10,
  aws_sns_topic_subscription:     10,
  aws_kinesis_stream:             10,
  aws_kinesis_firehose_delivery_stream: 10,
  aws_cloudwatch_event_rule:      10,
  aws_cloudwatch_event_target:    10,

  // Tier 11 — Monitoring / Secrets / Misc
  aws_cloudwatch_log_group:       11,
  aws_cloudwatch_metric_alarm:    11,
  aws_secretsmanager_secret:      11,
  aws_ssm_parameter:              11,
  aws_route53_zone:               11,
  aws_route53_record:             11,
  aws_acm_certificate:            11,
};

/** Human-readable section label for each tier number. */
const TIER_LABELS: Record<number, string> = {
  1:  'Networking',
  2:  'Security',
  3:  'IAM',
  4:  'Storage',
  5:  'Compute',
  6:  'Load Balancers',
  7:  'Containers',
  8:  'Serverless & API',
  9:  'Databases',
  10: 'Messaging & Eventing',
  11: 'Monitoring & Other',
};

function getTier(terraformType: string): number {
  return DEVOPS_TIERS[terraformType] ?? 11;
}

/**
 * Sorts MappedResources into DevOps deployment order:
 *   1. Group by tier (deployment layer)
 *   2. Within each tier, topological sort by dependency graph so that
 *      resources consumed by others come first.
 *   3. Within the same tier and same dependency level, preserve original order.
 */
function sortResourcesDevOpsOrder(resources: MappedResource[]): MappedResource[] {
  if (resources.length === 0) return resources;

  const idToResource = new Map<string, MappedResource>(
    resources.map(r => [r.node.id, r])
  );

  // Group into tier buckets
  const tierBuckets = new Map<number, MappedResource[]>();
  for (const r of resources) {
    const tier = getTier(r.terraformType);
    if (!tierBuckets.has(tier)) tierBuckets.set(tier, []);
    tierBuckets.get(tier)!.push(r);
  }

  const sorted: MappedResource[] = [];

  for (const tier of [...tierBuckets.keys()].sort((a, b) => a - b)) {
    const group = tierBuckets.get(tier)!;

    // Kahn's algorithm — topological sort within the tier group.
    const groupIds = new Set(group.map(r => r.node.id));
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>(); // id → ids that depend on it

    for (const r of group) {
      inDegree.set(r.node.id, 0);
      adjList.set(r.node.id, []);
    }

    for (const r of group) {
      for (const depId of r.dependencies) {
        if (groupIds.has(depId)) {
          // depId must come before r.node.id
          adjList.get(depId)!.push(r.node.id);
          inDegree.set(r.node.id, (inDegree.get(r.node.id) ?? 0) + 1);
        }
      }
    }

    // Seed queue with nodes that have no in-tier dependencies
    const queue: MappedResource[] = group.filter(r => inDegree.get(r.node.id) === 0);
    const tierSorted: MappedResource[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      tierSorted.push(current);

      for (const dependentId of adjList.get(current.node.id) ?? []) {
        const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) {
          const dep = idToResource.get(dependentId);
          if (dep) queue.push(dep);
        }
      }
    }

    // If a cycle existed within the tier, append any unvisited nodes as-is
    if (tierSorted.length < group.length) {
      const visitedIds = new Set(tierSorted.map(r => r.node.id));
      for (const r of group) {
        if (!visitedIds.has(r.node.id)) tierSorted.push(r);
      }
    }

    sorted.push(...tierSorted);
  }

  return sorted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value quoting
// ─────────────────────────────────────────────────────────────────────────────

const UNQUOTED_PREFIXES = ['var.', 'aws_', 'data.', 'module.', 'local.'];
const BOOLEAN_VALUES = new Set(['true', 'false']);

/**
 * Returns the value as a properly formatted HCL literal.
 * Expressions and booleans are unquoted; plain strings are quoted.
 */
export function formatHclValue(value: string): string {
  const v = value.trim();

  // Boolean literals
  if (BOOLEAN_VALUES.has(v)) return v;

  // Integer literals
  if (/^\d+$/.test(v)) return v;

  // Terraform expressions (references, function calls)
  if (UNQUOTED_PREFIXES.some(p => v.startsWith(p))) return v;

  // CIDR blocks, ARN patterns, or values with resource-reference-like dots
  // that should stay unquoted (e.g. "aws_iam_role.lambda_exec.arn")
  if (/^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(v)) return v;

  // Default: quoted string — escape backslashes and double-quotes
  const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ─────────────────────────────────────────────────────────────────────────────
// providers.tf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates `providers.tf` content.
 * Pins the AWS provider to a recent stable version constraint.
 */
export function buildProvidersTf(): string {
  return `terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "Terraform"
      GeneratedBy = "D2C-DrawioConverter"
    }
  }
}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// variables.tf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates `variables.tf` content.
 * Always includes `aws_region`.  Scans all resource arguments for `var.*`
 * references and emits a variable block for each unique one (excluding
 * `aws_region` which is already declared).
 */
export function buildVariablesTf(resources: MappedResource[]): string {
  const extraVars = new Set<string>();

  for (const r of resources) {
    for (const val of Object.values(r.arguments)) {
      const v = val.trim();
      if (v.startsWith('var.')) {
        const varName = v.slice(4).split('.')[0]; // var.foo.bar → foo
        if (varName && varName !== 'aws_region') {
          extraVars.add(varName);
        }
      }
    }
  }

  const lines: string[] = [];

  lines.push(`variable "aws_region" {`);
  lines.push(`  type        = string`);
  lines.push(`  description = "AWS region to deploy resources into"`);
  lines.push(`  default     = "us-east-1"`);
  lines.push(`}`);

  for (const varName of [...extraVars].sort()) {
    lines.push('');
    lines.push(`variable "${varName}" {`);
    lines.push(`  type        = string`);
    lines.push(`  description = "Value for ${varName}"`);
    lines.push(`}`);
  }

  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// main.tf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates `main.tf` content with one resource block per MappedResource.
 *
 * Resources are ordered the way a real DevOps engineer would write them:
 *   networking → security → IAM → storage → compute → load balancers
 *   → containers → serverless → databases → messaging → monitoring/other
 *
 * Within each tier, resources are topologically sorted so a resource always
 * appears after the resources it depends on.  Section header comments separate
 * each tier for readability.
 */
export function buildMainTf(resources: MappedResource[]): string {
  if (resources.length === 0) {
    return `# No recognisable AWS resources were found in the diagram.\n`;
  }

  // Sort resources into DevOps deployment order before rendering
  const ordered = sortResourcesDevOpsOrder(resources);

  // Build a lookup from node ID → "type.name" Terraform address
  const idToAddress = new Map<string, string>();
  for (const r of ordered) {
    idToAddress.set(r.node.id, `${r.terraformType}.${r.resourceName}`);
  }

  const blocks: string[] = [
    `# ─────────────────────────────────────────────────────────────────────────`,
    `# main.tf — Generated by D2C Draw.io → Terraform Converter`,
    `# Resources are ordered by deployment layer (networking first, compute`,
    `# after networking is ready, databases after compute, etc.)`,
    `# Review and complete all placeholder values before applying.`,
    `# ─────────────────────────────────────────────────────────────────────────`,
    '',
  ];

  let currentTier = -1;

  for (const resource of ordered) {
    const tier = getTier(resource.terraformType);

    // Emit a section header whenever the tier changes
    if (tier !== currentTier) {
      currentTier = tier;
      const label = TIER_LABELS[tier] ?? 'Other';
      const separator = '─'.repeat(Math.max(0, 73 - label.length));
      blocks.push(`# ── ${label} ${ separator}`);
      blocks.push('');
    }

    blocks.push(...buildResourceBlock(resource, idToAddress));
    blocks.push('');
  }

  return blocks.join('\n');
}

/**
 * Builds a single Terraform resource block as HCL lines.
 */
export function buildResourceBlock(resource: MappedResource, idToAddress?: Map<string, string>): string[] {
  const { terraformType, resourceName, arguments: args, dependencies } = resource;
  const lines: string[] = [];

  lines.push(`resource "${terraformType}" "${resourceName}" {`);

  // Emit arguments sorted alphabetically for deterministic output
  const sortedArgs = Object.entries(args).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, val] of sortedArgs) {
    lines.push(`  ${key} = ${formatHclValue(val)}`);
  }

  if (idToAddress) {
    // depends_on when dependencies resolve to known resource addresses
    const depAddresses = dependencies
      .map(id => idToAddress.get(id))
      .filter((addr): addr is string => addr !== undefined);

    if (depAddresses.length > 0) {
      lines.push('');
      lines.push('  depends_on = [');
      for (const addr of depAddresses) {
        lines.push(`    ${addr},`);
      }
      lines.push('  ]');
    }
  }

  lines.push('}');
  return lines;
}
