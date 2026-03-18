# Draw.io → Terraform (D2C)

A **Diagram-to-Code** web application that converts AWS infrastructure diagrams created in Draw.io into valid Terraform (`.tf`) files.

---

## Architecture

```
terraform-drawio-application/
├── backend/                        # Node.js · TypeScript · Express
│   └── src/
│       ├── server.ts               # Express app entry point (port 3001)
│       ├── types/index.ts          # Shared type definitions
│       ├── routes/convert.ts       # POST /api/convert
│       └── services/
│           ├── ingestion/
│           │   └── decompressor.ts # URL-decode → Base64 → pako.inflateRaw
│           ├── parser/
│           │   ├── xmlParser.ts    # xml2js → RawNode[] + ParsedEdge[]
│           │   └── hierarchyResolver.ts  # Recursive parent-child resolver
│           ├── mapper/
│           │   ├── awsMappings.json       # 35+ AWS icon → TF resource mappings
│           │   └── resourceMapper.ts      # Nodes → MappedResource[]
│           ├── metadata/
│           │   └── metadataExtractor.ts   # "Key: value" label parser
│           └── generator/
│               ├── hclTemplates.ts        # main.tf / variables.tf / providers.tf
│               └── zipBuilder.ts          # JSZip assembly
└── frontend/                       # React · Vite · Tailwind CSS
    └── src/
        ├── App.tsx                  # State management + fetch
        └── components/
            ├── FileUpload.tsx       # Drag-and-drop + file input
            └── ResultPanel.tsx      # Download button + warnings + errors
```

---

## Conversion Pipeline

```
.drawio file
    │
    ▼
[1] Decompressor       (URL-decode → Base64 → pako.inflateRaw → UTF-8 XML)
    │
    ▼
[2] XML Parser         (xml2js → RawNode vertices + ParsedEdge connectors)
    │
    ▼
[3] Hierarchy Resolver (recursive parent-child tree builder)
    │
    ▼
[4] flattenTree        (DFS → flat ParsedNode[])
    │
    ▼
[5] Resource Mapper    (awsMappings.json lookup → MappedResource[])
    │  metadata merge, name sanitisation, dependency resolution
    ▼
[6] HCL Generator      (main.tf + variables.tf + providers.tf)
    │
    ▼
[7] ZIP Builder        (JSZip → terraform.zip)
    │
    ▼
  HTTP Response  application/zip
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Install

```bash
npm install
```

### Development (both services, hot-reload)

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001/api

### Run tests

```bash
cd backend
npx jest
```

### Production build

```bash
npm run build
cd backend && npm start
```

---

## API

### `POST /api/convert`

**Request:** `multipart/form-data` with field `file` containing a `.drawio` file (max 5 MB).

**Response (success):** `200 application/zip` — `terraform.zip` containing:

| File | Contents |
|---|---|
| `terraform/providers.tf` | AWS provider + required_providers |
| `terraform/variables.tf` | `aws_region` + any `var.*` references |
| `terraform/main.tf` | One `resource` block per recognised AWS icon |

**Response headers (success):** `X-D2C-Warnings` — JSON array of non-fatal conversion warnings.

**Response (error):** JSON `{ "error": "...", "details": "..." }` with appropriate HTTP status (400 / 413 / 422 / 500).

---

## Supported AWS Icons (35+)

| Draw.io Style Key | Terraform Resource |
|---|---|
| `mxgraph.aws4.s3` / `bucket` | `aws_s3_bucket` |
| `mxgraph.aws4.lambda` / `lambda_function` | `aws_lambda_function` |
| `mxgraph.aws4.ec2` / `instance` | `aws_instance` |
| `mxgraph.aws4.vpc` | `aws_vpc` |
| `mxgraph.aws4.subnet` | `aws_subnet` |
| `mxgraph.aws4.rds` / `rds_instance` | `aws_db_instance` |
| `mxgraph.aws4.sqs` / `sqs_queue` | `aws_sqs_queue` |
| `mxgraph.aws4.sns` / `sns_topic` | `aws_sns_topic` |
| `mxgraph.aws4.role` / `iam_role` | `aws_iam_role` |
| `mxgraph.aws4.api_gateway` | `aws_api_gateway_rest_api` |
| `mxgraph.aws4.api_gateway2` | `aws_apigatewayv2_api` |
| `mxgraph.aws4.dynamo_db` / `dynamodb` | `aws_dynamodb_table` |
| `mxgraph.aws4.ecs` | `aws_ecs_cluster` |
| `mxgraph.aws4.ecs_service` | `aws_ecs_service` |
| `mxgraph.aws4.eks` | `aws_eks_cluster` |
| `mxgraph.aws4.elasticache` | `aws_elasticache_cluster` |
| `mxgraph.aws4.cloudfront` | `aws_cloudfront_distribution` |
| `mxgraph.aws4.route_53` / `route53` | `aws_route53_zone` |
| `mxgraph.aws4.application_load_balancer` | `aws_lb` (application) |
| `mxgraph.aws4.network_load_balancer` | `aws_lb` (network) |
| `mxgraph.aws4.security_group` | `aws_security_group` |
| `mxgraph.aws4.internet_gateway` | `aws_internet_gateway` |
| `mxgraph.aws4.nat_gateway` | `aws_nat_gateway` |
| `mxgraph.aws4.cloudwatch` | `aws_cloudwatch_log_group` |
| `mxgraph.aws4.kinesis` | `aws_kinesis_stream` |
| `mxgraph.aws4.secrets_manager` | `aws_secretsmanager_secret` |
| `mxgraph.aws4.step_functions` | `aws_sfn_state_machine` |

---

## Label Metadata

Any `Key: Value` lines in an icon's label are extracted and merged as HCL arguments:

```
my-ec2-instance
InstanceType: t3.large
AMI: ami-0abcdef1234567890
```

Generates:

```hcl
resource "aws_instance" "my_ec2_instance" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.large"
}
```

---

## After Download

```bash
cd terraform/
terraform init
terraform validate   # should pass
terraform plan
```

> **Note:** Review all placeholder values (e.g. `var.ami_id`, passwords) before `terraform apply`.
