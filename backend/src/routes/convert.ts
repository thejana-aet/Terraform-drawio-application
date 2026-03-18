/**
 * POST /api/convert
 *
 * Accepts a multipart/form-data upload with a single .drawio file,
 * runs the full conversion pipeline, and streams back a ZIP archive.
 *
 * Pipeline:
 *   1. Validate file upload (multer)
 *   2. Extract & decompress all diagram pages
 *   3. Parse XML → raw nodes + edges
 *   4. Resolve hierarchy → ParsedNode tree
 *   5. Flatten tree → pass to resource mapper
 *   6. Map resources → MappedResource[]
 *   7. Generate HCL files
 *   8. Assemble ZIP → send response
 *
 * Error handling:
 *   - 400 for client errors (no file, bad format)
 *   - 422 for diagrams that decompress/parse cleanly but yield no resources
 *   - 500 for unexpected server errors
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { extractDiagrams } from '../services/ingestion/decompressor';
import { parseDrawioXml } from '../services/parser/xmlParser';
import { resolveHierarchy, flattenTree } from '../services/parser/hierarchyResolver';
import { mapResources } from '../services/mapper/resourceMapper';
import { buildTerraformContents, buildZip } from '../services/generator/zipBuilder';
import { ApiErrorResponse } from '../types/index';

// ─────────────────────────────────────────────────────────────────────────────
// Multer configuration
// ─────────────────────────────────────────────────────────────────────────────

const FIVE_MB = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FIVE_MB, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['.drawio', '.xml'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .drawio and .xml files are accepted'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

export const convertRouter = Router();

convertRouter.post(
  '/convert',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // ── 1. Validate upload ───────────────────────────────────────────────
      if (!req.file) {
        const body: ApiErrorResponse = { error: 'No file uploaded', details: 'Attach a .drawio file with the field name "file"' };
        res.status(400).json(body);
        return;
      }

      const fileContent = req.file.buffer.toString('utf-8');

      // ── 2. Decompress ────────────────────────────────────────────────────
      let diagrams: string[];
      try {
        diagrams = extractDiagrams(fileContent);
      } catch (err) {
        const body: ApiErrorResponse = { error: 'Failed to decompress diagram', details: (err as Error).message };
        res.status(400).json(body);
        return;
      }

      // ── 3–4. Parse + resolve hierarchy (all pages merged) ────────────────
      const allWarnings: string[] = [];
      const allNodes = [];
      const allEdges = [];

      for (const xml of diagrams) {
        const { nodes, edges } = await parseDrawioXml(xml);
        allNodes.push(...nodes);
        allEdges.push(...edges);
      }

      const rootNodes = resolveHierarchy(allNodes, allEdges);

      // ── 5. Flatten tree ──────────────────────────────────────────────────
      const flat = flattenTree(rootNodes);

      // ── 6. Map resources ─────────────────────────────────────────────────
      const { resources, warnings } = mapResources(flat);
      allWarnings.push(...warnings);

      if (resources.length === 0) {
        const body: ApiErrorResponse = {
          error: 'No recognisable AWS resources found',
          details:
            'The diagram did not contain any supported AWS icons. ' +
            (allWarnings.length > 0 ? `Warnings: ${allWarnings.join('; ')}` : ''),
        };
        res.status(422).json(body);
        return;
      }

      // ── 7–8. Generate HCL & ZIP ──────────────────────────────────────────
      const contents = buildTerraformContents(resources);
      const zipBuffer = await buildZip(contents);

      // Attach warnings as a response header for visibility (non-blocking)
      if (allWarnings.length > 0) {
        res.setHeader('X-D2C-Warnings', JSON.stringify(allWarnings).slice(0, 2048));
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="terraform.zip"');
      res.setHeader('Content-Length', zipBuffer.length);
      res.send(zipBuffer);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Multer error handler (file size / type rejection)
// ─────────────────────────────────────────────────────────────────────────────
convertRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError || err instanceof Error) {
    if ((err as multer.MulterError).code === 'LIMIT_FILE_SIZE') {
      const body: ApiErrorResponse = { error: 'File too large', details: 'Maximum allowed size is 5 MB' };
      res.status(413).json(body);
      return;
    }
    const body: ApiErrorResponse = { error: 'Upload error', details: (err as Error).message };
    res.status(400).json(body);
    return;
  }
  next(err);
});
