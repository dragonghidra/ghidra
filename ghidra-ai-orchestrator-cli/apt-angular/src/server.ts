import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import { SessionEvent, SessionCommandPayload } from './shared/session-models';
import { SessionRegistry } from './backend/session/session-registry';
import type { SessionHandle } from './backend/session/session-registry';
import { SessionTokenStore, buildSessionCookieName } from './backend/session/session-token-store';
import type { SessionAccessPayload } from './backend/session/session-access';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();
const sessionRegistry = new SessionRegistry();
const tokenStore = new SessionTokenStore();

app.use(express.json());

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || !rawValue) {
      return acc;
    }

    const key = rawKey.trim();
    const value = rawValue.trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
};

const streamEvent = (res: Response, event: SessionEvent): void => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

const extractSessionId = (req: Request): string | undefined => {
  if (typeof req.params['sessionId'] === 'string') {
    return req.params['sessionId'];
  }

  const queryValue = req.query['sessionId'];
  return typeof queryValue === 'string' ? queryValue : undefined;
};

const resolveSessionHandle = async (req: Request): Promise<SessionHandle> => {
  const sessionId = extractSessionId(req);
  return sessionRegistry.get(sessionId);
};

const extractSessionCookie = (req: Request, sessionId: string): string | undefined => {
  const cookies = parseCookies(req.headers['cookie']);
  return cookies[buildSessionCookieName(sessionId)];
};

const setSessionCookie = (res: Response, sessionId: string, token: string): void => {
  const name = buildSessionCookieName(sessionId);
  const secure = process.env['NODE_ENV'] !== 'development';
  const cookie = `${name}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(tokenStore.ttl / 1000)}${
    secure ? '; Secure' : ''
  }`;

  const existing = res.getHeader('Set-Cookie');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else if (existing) {
    res.setHeader('Set-Cookie', [existing.toString(), cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
};

const ensureAuthorized = async (req: Request, handle: SessionHandle): Promise<void> => {
  const cookieToken = extractSessionCookie(req, handle.config.sessionId);
  if (tokenStore.validate(cookieToken, handle.config.sessionId)) {
    return;
  }

  await handle.access.assertAuthorized(req);
};

const handleSessionRequest = async (req: Request, res: Response) => {
  const handle = await resolveSessionHandle(req);
  await ensureAuthorized(req, handle);
  const snapshot = handle.orchestrator.getSnapshot();
  res.json({
    ...snapshot,
    source: handle.config.source,
    sessionId: handle.config.sessionId
  });
};

const handleCommandRequest = async (req: Request, res: Response) => {
  const handle = await resolveSessionHandle(req);
  await ensureAuthorized(req, handle);
  const payload = req.body as SessionCommandPayload | undefined;

  if (!payload?.text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  try {
    await handle.orchestrator.sendCommand(payload);
    res.status(202).json({ accepted: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
};

const handleStreamRequest = async (req: Request, res: Response) => {
  const handle = await resolveSessionHandle(req);
  await ensureAuthorized(req, handle);

  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');

  res.flushHeaders?.();

  streamEvent(res, { type: 'session', payload: handle.orchestrator.getSnapshot() });

  const unsubscribe = handle.orchestrator.subscribe((event) => streamEvent(res, event));
  const keepAlive = setInterval(() => res.write(':\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
};

const handleAccessGrant = async (req: Request, res: Response) => {
  const handle = await resolveSessionHandle(req);
  const payload = (req.body ?? {}) as SessionAccessPayload;
  await handle.access.assertPayload(payload);
  const token = tokenStore.issue(handle.config.sessionId);
  setSessionCookie(res, handle.config.sessionId, token);
  res.json({ status: 'ok', expiresIn: tokenStore.ttl });
};

const withErrorHandling =
  (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: (error?: unknown) => void) =>
    handler(req, res).catch((error) => {
      if (error instanceof Error && /passphrase|token|required/i.test(error.message)) {
        res.status(401).json({ error: error.message });
        return;
      }

      next(error);
    });

app.get(['/api/session', '/api/session/:sessionId'], withErrorHandling(handleSessionRequest));

app.post(['/api/session/commands', '/api/session/:sessionId/commands'], withErrorHandling(handleCommandRequest));

app.get(['/api/session/stream', '/api/session/:sessionId/stream'], withErrorHandling(handleStreamRequest));

app.post(['/api/session/access', '/api/session/:sessionId/access'], withErrorHandling(handleAccessGrant));

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
