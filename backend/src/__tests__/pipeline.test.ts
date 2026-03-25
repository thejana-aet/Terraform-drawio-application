/**
 * Unit Tests — Core Pipeline Services
 *
 * Run with:  npm test  (from the backend/ directory)
 */

import { decompressDiagram, extractDiagrams } from '../services/ingestion/decompressor';
import { extractMetadata, extractResourceName } from '../services/metadata/metadataExtractor';
import { resolveHierarchy, flattenTree } from '../services/parser/hierarchyResolver';
import { mapResources } from '../services/mapper/resourceMapper';
import { parseDrawioXml } from '../services/parser/xmlParser';
import { buildMainTf, buildVariablesTf, buildProvidersTf } from '../services/generator/hclTemplates';
import { RawNode, ParsedEdge } from '../types/index';

// ─────────────────────────────────────────────────────────────────────────────
// Decompressor tests
// ─────────────────────────────────────────────────────────────────────────────

describe('decompressDiagram', () => {
  it('returns plain XML unchanged when already decompressed', () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    expect(decompressDiagram(xml)).toBe(xml);
  });

  it('decompresses a known compressed Draw.io payload', () => {
    // pako deflateRaw + base64 encode a minimal mxGraphModel
    const pako = require('pako') as typeof import('pako');
    const original = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1"/></root></mxGraphModel>';
    const compressed = Buffer.from(pako.deflateRaw(original)).toString('base64');
    const result = decompressDiagram(compressed);
    expect(result).toBe(original);
  });

  it('throws when decompression yields non-mxGraphModel content', () => {
    // Valid base64 of deflated non-XML content
    const pako = require('pako') as typeof import('pako');
    const junk = 'this is not xml';
    const compressed = Buffer.from(pako.deflateRaw(junk)).toString('base64');
    expect(() => decompressDiagram(compressed)).toThrow('mxGraphModel');
  });
});

describe('extractDiagrams', () => {
  it('extracts a plain-XML diagram from an mxfile wrapper', () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    const mxfile = `<mxfile><diagram id="p1" name="Page-1">${xml}</diagram></mxfile>`;
    const result = extractDiagrams(mxfile);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('<mxGraphModel');
  });

  it('throws when no diagram elements are present', () => {
    expect(() => extractDiagrams('<xml><nothing/></xml>')).toThrow('<diagram>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Metadata extractor tests
// ─────────────────────────────────────────────────────────────────────────────

describe('extractMetadata', () => {
  it('returns empty object for a plain name label', () => {
    expect(extractMetadata('My Lambda Function')).toEqual({});
  });

  it('extracts a single key-value pair', () => {
    expect(extractMetadata('Runtime: nodejs20.x')).toEqual({ Runtime: 'nodejs20.x' });
  });

  it('extracts multiple pairs from a multi-line label', () => {
    const label = 'web-server\nInstanceType: t3.micro\nAMI: ami-0abcdef1234567890';
    const meta = extractMetadata(label);
    expect(meta).toEqual({
      InstanceType: 't3.micro',
      AMI: 'ami-0abcdef1234567890',
    });
  });

  it('handles HTML-formatted labels', () => {
    const label = '<b>My DB</b><br>Engine: mysql<br>Version: 8.0';
    const meta = extractMetadata(label);
    expect(meta).toEqual({ Engine: 'mysql', Version: '8.0' });
  });

  it('returns empty object for empty string', () => {
    expect(extractMetadata('')).toEqual({});
  });
});

describe('extractResourceName', () => {
  it('returns non-KV lines joined as the name', () => {
    const label = 'web-server\nInstanceType: t3.micro';
    expect(extractResourceName(label)).toBe('web-server');
  });

  it('returns empty string when all lines are KV pairs', () => {
    const label = 'Name: foo\nType: bar';
    expect(extractResourceName(label)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy resolver tests
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveHierarchy', () => {
  const makeNode = (id: string, parentId: string | null, awsKey = 'mxgraph.aws4.ec2'): RawNode => ({
    id,
    label: `Node ${id}`,
    style: `shape=${awsKey};`,
    awsServiceKey: awsKey,
    parentId,
  });

  it('creates root nodes for cells with no parent', () => {
    const nodes = [makeNode('2', null), makeNode('3', null)];
    const roots = resolveHierarchy(nodes, []);
    expect(roots).toHaveLength(2);
  });

  it('nests child nodes inside their parent', () => {
    // vpc (2) → subnet (3) → ec2 (4)
    const nodes = [
      makeNode('2', null, 'mxgraph.aws4.vpc'),
      makeNode('3', '2', 'mxgraph.aws4.subnet'),
      makeNode('4', '3', 'mxgraph.aws4.ec2'),
    ];
    const roots = resolveHierarchy(nodes, []);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].children).toHaveLength(1);
    expect(roots[0].children[0].children[0].id).toBe('4');
  });

  it('marks containers correctly', () => {
    const nodes = [
      makeNode('2', null, 'mxgraph.aws4.vpc'),
      makeNode('3', '2', 'mxgraph.aws4.ec2'),
    ];
    const roots = resolveHierarchy(nodes, []);
    expect(roots[0].isContainer).toBe(true);
    expect(roots[0].children[0].isContainer).toBe(false);
  });

  it('attaches edges to both source and target nodes', () => {
    const nodes = [makeNode('2', null), makeNode('3', null)];
    const edges: ParsedEdge[] = [{ id: 'e1', source: '2', target: '3' }];
    const roots = resolveHierarchy(nodes, edges);
    const nodeMap = Object.fromEntries(roots.map(n => [n.id, n]));
    expect(nodeMap['2'].edges).toHaveLength(1);
    expect(nodeMap['3'].edges).toHaveLength(1);
  });
});

describe('flattenTree', () => {
  it('returns all nodes in DFS order', () => {
    const nodes: RawNode[] = [
      { id: '2', label: 'VPC', style: 'shape=mxgraph.aws4.vpc;', awsServiceKey: 'mxgraph.aws4.vpc', parentId: null },
      { id: '3', label: 'EC2', style: 'shape=mxgraph.aws4.ec2;', awsServiceKey: 'mxgraph.aws4.ec2', parentId: '2' },
    ];
    const roots = resolveHierarchy(nodes, []);
    const flat = flattenTree(roots);
    expect(flat).toHaveLength(2);
    const ids = flat.map(n => n.id);
    expect(ids).toContain('2');
    expect(ids).toContain('3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// XML Parser tests
// ─────────────────────────────────────────────────────────────────────────────

describe('parseDrawioXml', () => {
  const MINIMAL_XML = `
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="My Lambda" style="shape=mxgraph.aws4.lambda;fillColor=#F58534;" vertex="1" parent="1"/>
        <mxCell id="3" value="My S3" style="shape=mxgraph.aws4.s3;" vertex="1" parent="1"/>
        <mxCell id="4" edge="1" source="2" target="3" parent="1"/>
      </root>
    </mxGraphModel>`;

  it('extracts vertices and edges', async () => {
    const { nodes, edges } = await parseDrawioXml(MINIMAL_XML);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('extracts the correct awsServiceKey', async () => {
    const { nodes } = await parseDrawioXml(MINIMAL_XML);
    const keys = nodes.map(n => n.awsServiceKey).sort();
    expect(keys).toEqual(['mxgraph.aws4.lambda', 'mxgraph.aws4.s3']);
  });

  it('extracts awsServiceKey from resIcon and multi-segment shape values', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="2" value="My EC2" style="shape=mxgraph.aws4.compute.ec2_instance;" vertex="1" parent="1"/>
        <mxCell id="3" value="My Lambda" style="resIcon=mxgraph.aws4.lambda;" vertex="1" parent="1"/>
      </root></mxGraphModel>`;
    const { nodes } = await parseDrawioXml(xml);
    expect(nodes.map(n => n.awsServiceKey).sort()).toEqual([
      'mxgraph.aws4.compute.ec2_instance',
      'mxgraph.aws4.lambda',
    ]);
  });

  it('extracts awsServiceKey when style is defined on UserObject', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <UserObject id="ec2-uo" label="Web EC2" style="shape=mxgraph.aws4.ec2;">
          <mxCell id="inner-1" vertex="1" parent="1"/>
        </UserObject>
      </root></mxGraphModel>`;
    const { nodes } = await parseDrawioXml(xml);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].awsServiceKey).toBe('mxgraph.aws4.ec2');
    expect(nodes[0].label).toBe('Web EC2');
    expect(nodes[0].id).toBe('ec2-uo');
  });

  it('skips sentinel cells id=0 and id=1', async () => {
    const { nodes } = await parseDrawioXml(MINIMAL_XML);
    expect(nodes.find(n => n.id === '0')).toBeUndefined();
    expect(nodes.find(n => n.id === '1')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resource Mapper tests
// ─────────────────────────────────────────────────────────────────────────────

describe('mapResources', () => {
  it('maps a Lambda node to aws_lambda_function', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="2" value="my-func" style="shape=mxgraph.aws4.lambda;" vertex="1" parent="1"/>
      </root></mxGraphModel>`;
    const { nodes, edges } = await parseDrawioXml(xml);
    const roots = resolveHierarchy(nodes, edges);
    const { resources, warnings } = mapResources(flattenTree(roots));
    expect(resources).toHaveLength(1);
    expect(resources[0].terraformType).toBe('aws_lambda_function');
    expect(warnings).toHaveLength(0);
  });

  it('merges metadata from label into arguments', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="2" value="my-ec2&#xa;InstanceType: t3.large" style="shape=mxgraph.aws4.ec2;" vertex="1" parent="1"/>
      </root></mxGraphModel>`;
    const { nodes, edges } = await parseDrawioXml(xml);
    const roots = resolveHierarchy(nodes, edges);
    const { resources } = mapResources(flattenTree(roots));
    expect(resources[0].arguments['instance_type']).toBe('t3.large');
  });

  it('emits a warning for unrecognised AWS icon keys', async () => {
    // Construct node manually to avoid XML parsing
    const pNode = {
      id: 'x1', label: 'Unknown', style: 'shape=mxgraph.aws4.unknownservice;',
      awsServiceKey: 'mxgraph.aws4.unknownservice', parentId: null,
      children: [], edges: [], metadata: {}, isContainer: false,
    };
    const { warnings } = mapResources([pNode]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('mxgraph.aws4.unknownservice');
  });

  it('maps ec2 instance icon variants to aws_instance', async () => {
    const pNode = {
      id: 'ec2-1', label: 'EC2 Instance', style: 'shape=mxgraph.aws4.compute.ec2_instance;',
      awsServiceKey: 'mxgraph.aws4.compute.ec2_instance', parentId: null,
      children: [], edges: [], metadata: {}, isContainer: false,
    };
    const { resources, warnings } = mapResources([pNode]);
    expect(warnings).toHaveLength(0);
    expect(resources).toHaveLength(1);
    expect(resources[0].terraformType).toBe('aws_instance');
  });

  it('maps EC2 by label when awsServiceKey is missing', () => {
    const pNode = {
      id: 'ec2-no-key', label: 'EC2 Instance', style: 'rounded=1;html=1;',
      awsServiceKey: '', parentId: null,
      children: [], edges: [], metadata: {}, isContainer: false,
    };
    const { resources, warnings } = mapResources([pNode]);
    expect(warnings).toHaveLength(0);
    expect(resources).toHaveLength(1);
    expect(resources[0].terraformType).toBe('aws_instance');
  });

  it('maps multiple EC2 icon variants through aliases', async () => {
    const variants = [
      'mxgraph.aws4.ec2_instance',
      'mxgraph.aws4.ec2_instances',
      'mxgraph.aws4.amazon_ec2',
      'mxgraph.aws4.instances',
      'mxgraph.aws4.compute.ec2',
    ];
    for (const variant of variants) {
      const pNode = {
        id: `ec2-${variant}`, label: 'EC2 Instance', style: `shape=${variant};`,
        awsServiceKey: variant, parentId: null,
        children: [], edges: [], metadata: {}, isContainer: false,
      };
      const { resources, warnings } = mapResources([pNode]);
      expect(warnings.length).toBe(0);
      expect(resources.length).toBe(1);
      expect(resources[0].terraformType).toBe('aws_instance');
    }
  });

  it('maps IGW variants through aliases', async () => {
    const variants = [
      'mxgraph.aws4.igw',
      'mxgraph.aws4.internet_gw',
      'mxgraph.aws4.internetgateway',
    ];
    for (const variant of variants) {
      const pNode = {
        id: `igw-${variant}`, label: 'Internet Gateway', style: `shape=${variant};`,
        awsServiceKey: variant, parentId: null,
        children: [], edges: [], metadata: {}, isContainer: false,
      };
      const { resources, warnings } = mapResources([pNode]);
      expect(warnings.length).toBe(0);
      expect(resources.length).toBe(1);
      expect(resources[0].terraformType).toBe('aws_internet_gateway');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HCL Generator tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildProvidersTf', () => {
  it('contains required_providers aws block', () => {
    const output = buildProvidersTf();
    expect(output).toContain('required_providers');
    expect(output).toContain('hashicorp/aws');
    expect(output).toContain('var.aws_region');
  });
});

describe('buildVariablesTf', () => {
  it('always includes aws_region variable', () => {
    const output = buildVariablesTf([]);
    expect(output).toContain('variable "aws_region"');
  });

  it('adds variables for referenced var.* values', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="2" value="my-bucket" style="shape=mxgraph.aws4.s3;" vertex="1" parent="1"/>
      </root></mxGraphModel>`;
    const { nodes, edges } = await parseDrawioXml(xml);
    const roots = resolveHierarchy(nodes, edges);
    const { resources } = mapResources(flattenTree(roots));
    const output = buildVariablesTf(resources);
    // S3 defaults include var.bucket_name
    expect(output).toContain('variable "bucket_name"');
  });
});

describe('buildMainTf', () => {
  it('generates a resource block for each MappedResource', async () => {
    const xml = `
      <mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="2" value="fn" style="shape=mxgraph.aws4.lambda;" vertex="1" parent="1"/>
        <mxCell id="3" value="queue" style="shape=mxgraph.aws4.sqs;" vertex="1" parent="1"/>
      </root></mxGraphModel>`;
    const { nodes, edges } = await parseDrawioXml(xml);
    const roots = resolveHierarchy(nodes, edges);
    const { resources } = mapResources(flattenTree(roots));
    const output = buildMainTf(resources);
    expect(output).toContain('resource "aws_lambda_function"');
    expect(output).toContain('resource "aws_sqs_queue"');
  });

  it('emits a comment when no resources are present', () => {
    const output = buildMainTf([]);
    expect(output).toContain('No recognisable AWS resources');
  });
});
