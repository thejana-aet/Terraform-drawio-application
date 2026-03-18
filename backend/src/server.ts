/**
 * Express Application Entry Point
 *
 * Starts an HTTP server on PORT (default 3001).
 * All API routes are mounted under /api.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { convertRouter } from './routes/convert';
import { ApiErrorResponse } from './types/index';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['Content-Disposition', 'X-D2C-Warnings'],
}));

// Compress all responses > 1KB (skips already-compressed zip responses automatically)
app.use(compression());

// Parse JSON bodies (used by health check; convert endpoint uses multipart)
app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'D2C Backend',
    status: 'running',
    endpoints: {
      health:  'GET  /api/health',
      convert: 'POST /api/convert  (multipart/form-data, field: file)',
    },
    note: 'The UI is served by Vite at http://localhost:5173',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', convertRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[D2C Error]', err);
  const body: ApiErrorResponse = {
    error: 'Internal server error',
    details: err instanceof Error ? err.message : String(err),
  };
  res.status(500).json(body);
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[D2C Backend] Server running on http://localhost:${PORT}`);
  console.log(`[D2C Backend] Health:   GET  http://localhost:${PORT}/api/health`);
  console.log(`[D2C Backend] Convert:  POST http://localhost:${PORT}/api/convert`);
});

export default app;
