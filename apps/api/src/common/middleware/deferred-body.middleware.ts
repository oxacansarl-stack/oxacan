import type { NextFunction, Request, RequestHandler, Response } from 'express';

const DEFERRED = Symbol('deferredBodyParser');

type DeferrableRequest = Request & { [DEFERRED]?: RequestHandler; _body?: boolean };

/**
 * Defers a (large-limit) body parser until the request is authenticated.
 *
 * Mounted in main.ts before Nest's own body parsers. For a POST to exactly the mount path it does
 * not read the body: it parks `parser` on the request and marks the body as handled, so Nest's
 * 100 kb parsers skip it. DeferredBodyInterceptor, which runs after every guard (authentication,
 * company context, roles, rate limit), then runs the parser before the pipes validate the body.
 * Until then the body stays in the socket: a request refused by a guard is answered without the
 * API buffering or parsing it (Node discards the unread rest).
 *
 * Only requests whose Content-Type matches `type` are deferred; other methods, content types and
 * sub-paths (e.g. the multipart /catalogue/import/pdf) pass through to the usual parsers.
 */
export function deferBody(type: string, parser: RequestHandler) {
  // Not named "jsonParser": Nest would take it for its own global parser and skip registering one.
  return function deferredBody(req: Request, _res: Response, next: NextFunction) {
    if (req.method === 'POST' && (req.path === '/' || req.path === '') && req.is(type)) {
      const r = req as DeferrableRequest;
      r[DEFERRED] = parser;
      r._body = true; // body-parser's "already parsed" flag
    }
    next();
  };
}

/** Runs the parser deferBody() parked on this request, if any. Resolves once the body is parsed. */
export function parseDeferredBody(req: Request, res: Response): Promise<void> {
  const r = req as DeferrableRequest;
  const parser = r[DEFERRED];
  if (!parser) return Promise.resolve();
  delete r[DEFERRED];
  r._body = false;
  return new Promise((resolve, reject) => {
    parser(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}
