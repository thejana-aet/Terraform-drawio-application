/**
 * ZIP Builder
 *
 * Assembles the three generated Terraform files into a single in-memory ZIP
 * archive using JSZip and returns a Node.js Buffer ready to be streamed to
 * the HTTP response.
 *
 * Archive structure:
 *   terraform/
 *     providers.tf
 *     variables.tf
 *     main.tf
 */

import JSZip from 'jszip';
import { MappedResource } from '../../types/index';
import { buildMainTf, buildVariablesTf, buildProvidersTf } from './hclTemplates';

export interface ZipContents {
  mainTf: string;
  variablesTf: string;
  providersTf: string;
}

/**
 * Generates Terraform file contents from the provided resources.
 */
export function buildTerraformContents(resources: MappedResource[]): ZipContents {
  return {
    providersTf: buildProvidersTf(),
    variablesTf: buildVariablesTf(resources),
    mainTf: buildMainTf(resources),
  };
}

/**
 * Creates a ZIP archive containing the three Terraform files.
 *
 * @param contents - Pre-generated file contents (or call `buildTerraformContents` first)
 * @returns         A Buffer containing the complete ZIP archive.
 */
export async function buildZip(contents: ZipContents): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder('terraform')!;

  folder.file('providers.tf', contents.providersTf, { date: new Date() });
  folder.file('variables.tf', contents.variablesTf, { date: new Date() });
  folder.file('main.tf', contents.mainTf, { date: new Date() });

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return buffer;
}
