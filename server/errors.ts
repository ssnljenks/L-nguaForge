import type {NextFunction, Request, RequestHandler, Response} from 'express';

/** An error whose message is safe to show to end users. */
export class UserFacingError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'UserFacingError';
    this.status = status;
  }
}

/** Thrown when the HTTP client disconnected before we finished; nothing should be sent. */
export class ClientAbortedError extends Error {
  constructor() {
    super('Client disconnected');
    this.name = 'ClientAbortedError';
  }
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const obj = err && typeof err === 'object' ? (err as {message?: unknown; error?: {message?: unknown}}) : null;
  if (typeof obj?.message === 'string') return obj.message;
  if (typeof obj?.error?.message === 'string') return obj.error.message;
  return 'Unexpected server error';
}

function extractStatus(err: unknown): number | undefined {
  const status = err && typeof err === 'object' ? (err as {status?: unknown}).status : undefined;
  return typeof status === 'number' ? status : undefined;
}

export type GeminiErrorKind = 'auth' | 'rate_limited' | 'unavailable' | 'model_not_found' | 'unknown';

/** Classifies SDK/API errors by HTTP status when present, falling back to message text. */
export function classifyGeminiError(err: unknown): GeminiErrorKind {
  const status = extractStatus(err);
  const msg = extractMessage(err);
  if (status === 401 || status === 403 || /\b403\b|PERMISSION_DENIED|API_KEY_INVALID|API key not valid/.test(msg)) {
    return 'auth';
  }
  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED/.test(msg)) return 'rate_limited';
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /\b50[0234]\b|UNAVAILABLE|high demand|DEADLINE_EXCEEDED/.test(msg)
  ) {
    return 'unavailable';
  }
  if (status === 404 || /\b404\b|NOT_FOUND/.test(msg)) return 'model_not_found';
  return 'unknown';
}

export function isTransientGeminiError(err: unknown): boolean {
  const kind = classifyGeminiError(err);
  return kind === 'rate_limited' || kind === 'unavailable';
}

/** Maps any error to a status code and a message that is safe to return to the browser. */
export function toPublicError(err: unknown): {status: number; message: string} {
  if (err instanceof UserFacingError) {
    return {status: err.status, message: err.message};
  }
  switch (classifyGeminiError(err)) {
    case 'auth':
      console.error('[gemini] authentication failed:', extractMessage(err));
      return {status: 403, message: 'Gemini API authentication failed. Verify your API key in Settings > Secrets.'};
    case 'rate_limited':
      return {status: 429, message: 'Gemini API rate limit reached. Please wait a moment and try again.'};
    case 'unavailable':
      return {status: 503, message: 'Gemini is experiencing a brief demand spike. Please tap Send again in a moment.'};
    case 'model_not_found':
      console.error('[gemini] model not found:', extractMessage(err));
      return {status: 502, message: 'The configured AI model is unavailable right now. Please try again later.'};
    default:
      // Unknown failure: keep details in server logs, never in the response.
      console.error('[server] unexpected error:', err);
      return {status: 500, message: 'Something went wrong on the server. Please try again.'};
  }
}

/** Aborts when the client disconnects before the response has been sent. */
export function createClientAbortSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export type AsyncRouteHandler = (req: Request, res: Response, signal: AbortSignal) => Promise<unknown>;

/**
 * Wraps an async Express handler: every rejection becomes a sanitized JSON error,
 * and the handler receives a signal that fires if the client goes away.
 */
export function handleAsync(handler: AsyncRouteHandler): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    const signal = createClientAbortSignal(res);
    handler(req, res, signal).catch((err: unknown) => {
      if (err instanceof ClientAbortedError || signal.aborted || res.headersSent) return;
      const {status, message} = toPublicError(err);
      res.status(status).json({error: message});
    });
  };
}
