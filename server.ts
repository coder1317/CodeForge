import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { initialPipelineState, PipelineState } from './src/agents/state';
import { CodeForgeOrchestrator } from './src/agents/graph';
import { PROVIDER_POOL } from './src/lib/providers/pool';
import { rateLimitTracker } from './src/lib/providers/rateLimitTracker';
import { checkOllamaHealth } from './src/lib/ollamaHealth';
import { refreshOllamaModels } from './src/lib/ollamaModels';

dotenv.config();

// Simple in-memory rate limiter for the generation endpoint (per client IP).
// Good enough for a local/self-hosted tool; a shared store (Redis) would be
// needed for multi-process horizontal scaling.
const GEN_WINDOW_MS = 60_000;
const GEN_MAX_REQUESTS = 10; // 10 generation requests / minute / client
const GEN_MAX_CONCURRENT = 2;
const genTimestamps = new Map<string, number[]>();
let activeGenerations = 0;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (genTimestamps.get(ip) || []).filter((t) => now - t < GEN_WINDOW_MS);
  if (list.length >= GEN_MAX_REQUESTS) return true;
  list.push(now);
  genTimestamps.set(ip, list);
  // Periodic sweep: drop stale entries so the map can't grow unboundedly
  // when many distinct client IPs appear over a long uptime.
  if (now - lastLimiterSweep > GEN_WINDOW_MS) {
    lastLimiterSweep = now;
    for (const [key, stamps] of genTimestamps) {
      const fresh = stamps.filter((t) => now - t < GEN_WINDOW_MS);
      if (fresh.length === 0) genTimestamps.delete(key);
      else genTimestamps.set(key, fresh);
    }
  }
  return false;
}
let lastLimiterSweep = Date.now();

// Active generation abort controllers — used by graceful shutdown to cancel
// every in-flight pipeline when the process is asked to terminate.
const activeGenerationControllers = new Set<AbortController>();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // CORS restricted to configured origins (comma-separated), defaulting to localhost.
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '256kb' }));

  // Behind a reverse proxy (nginx/Cloudflare), trust the proxy's X-Forwarded-For
  // so req.ip reflects the real client and per-IP rate limits work per client.
  if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  }

  // Liveness/readiness probe for uptime monitors and container orchestrators.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      activeGenerations,
      timestamp: new Date().toISOString()
    });
  });

  // API Route: Provider Status & Health Check
  app.get('/api/providers/status', async (req, res) => {
    // Warm the Ollama model cache so the selector picks an installed model.
    // Fire-and-forget: never block this frequently-polled endpoint.
    refreshOllamaModels().catch(() => {});
    const ollamaStatus = await checkOllamaHealth();
    const providersList = Object.values(PROVIDER_POOL).map(p => {
      const hasEnvKey = Boolean(p.envVarName && process.env[p.envVarName]);
      return {
        ...p,
        currentRPM: rateLimitTracker.getRPM(p.id),
        hasKey: hasEnvKey || p.free || !p.requiresKey,
        isRateLimited: rateLimitTracker.isRateLimited(p.id, p.rateLimitRPM)
      };
    });

    res.json({
      providers: providersList,
      ollama: ollamaStatus,
      timestamp: new Date().toISOString()
    });
  });

  // API Route: SSE Generation Endpoint
  app.post('/api/generate', async (req, res) => {
    const { prompt, byokKeys } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > 4000) {
      return res.status(400).json({ error: 'Prompt is too long (max 4000 characters)' });
    }

    // Reject for concurrency BEFORE recording the rate-limit hit, so requests
    // refused by the concurrency cap don't consume the client's per-minute quota.
    if (activeGenerations >= GEN_MAX_CONCURRENT) {
      return res.status(429).json({ error: 'Another generation is already running. Wait for it to finish.' });
    }
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many generation requests. Please wait a minute and retry.' });
    }
    activeGenerations++;

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx response buffering
    res.flushHeaders();

    const sendSSE = (event: string, data: unknown) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // socket already gone — the close handler will abort the pipeline
      }
    };

    const initialState: PipelineState = {
      ...initialPipelineState,
      prompt,
      logs: [
        {
          id: 'log_init',
          timestamp: new Date().toLocaleTimeString(),
          agent: 'Orchestrator',
          provider: 'CodeForge Engine',
          message: `Initiating multi-agent pipeline for project: "${prompt}"`,
          type: 'info'
        }
      ]
    };

    const orchestrator = new CodeForgeOrchestrator(initialState, {
      byokKeys,
      envVars: process.env,
      onLog: (log) => {
        sendSSE('log', log);
      }
    });

    // Abort generation when the client disconnects — don't keep burning
    // provider quota / CPU on a job nobody is watching.
    //
    // IMPORTANT: listen on `res`, NOT `req`. On a fully-consumed POST body,
    // Node fires `req 'close'` as soon as the request is read (IncomingMessage
    // 'close' means "request completed"), which would abort every generation
    // before the first SSE event — the pipeline would stream zero bytes.
    // `res 'close'` fires only when the underlying socket closes, i.e. a real
    // client disconnect, which is the correct abort signal for SSE.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);
    activeGenerationControllers.add(controller);

    // SSE heartbeat: during long LLM calls (up to 150s) no bytes flow, which
    // lets intermediate proxies time the connection out. A comment frame keeps
    // the socket warm without disturbing EventSource parsers.
    const heartbeat = setInterval(() => {
      try {
        res.write(':hb\n\n');
      } catch {
        // socket gone; close handler aborts the pipeline
      }
    }, 15_000);

    try {
      for await (const step of orchestrator.runStream(controller.signal)) {
        if (controller.signal.aborted) break;
        sendSSE(step.event, step.data);
      }
    } catch (err: unknown) {
      if ((err instanceof Error && err.name === 'AbortError') || controller.signal.aborted) {
        console.warn('[Generate] Client disconnected, generation aborted.');
        try {
          sendSSE('error', { error: 'Generation aborted (client disconnected)' });
        } catch {
          // socket already gone
        }
      } else {
        console.error('[Generate Route Error]:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        sendSSE('error', { error: errMsg });
      }
    } finally {
      clearInterval(heartbeat);
      activeGenerations--;
      activeGenerationControllers.delete(controller);
      res.removeListener('close', onClose);
      res.end();
    }
  });

  // Vite Middleware for Dev vs Production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Centralized error handler - must come AFTER all routes. Preserves HTTP status
  // codes raised by middleware (e.g. 413 for oversized bodies) but never leaks raw
  // provider errors (they can contain URLs, model names, internal details) to clients.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message = status >= 400 && status < 500 && 'message' in (err as object)
      ? String((err as { message: unknown }).message)
      : 'Internal server error';
    console.error('[Server Error]', status, err);
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  });

  const HOST = process.env.HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => {
    console.log(`CodeForge V2 server running on http://${HOST}:${PORT}`);
    // Fire-and-forget: discover installed Ollama models for the provider selector.
    refreshOllamaModels().catch(() => {});
  });

  // Graceful shutdown: stop accepting connections, abort every in-flight
  // generation (no half-written pipelines), and exit once drained.
  let shuttingDown = false;
  const shutdown = (signalName: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${signalName}] Shutting down CodeForge...`);
    for (const c of activeGenerationControllers) {
      try {
        c.abort();
      } catch {
        // already aborted
      }
    }
    server.close(() => process.exit(0));
    // Hard exit if something refuses to drain (e.g. a stuck keep-alive socket).
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
