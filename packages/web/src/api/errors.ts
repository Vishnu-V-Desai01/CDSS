export class NetworkError extends Error {
  constructor(public cause: unknown) {
    super('Backend not reachable');
    this.name = 'NetworkError';
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public requestId?: string,
  ) {
    super(`Backend returned ${status}`);
    this.name = 'HttpError';
  }
}

export class ContractError extends Error {
  constructor(public detail: string, public received: unknown) {
    super(`Response did not match the expected contract: ${detail}`);
    this.name = 'ContractError';
  }
}

export type ApiError = NetworkError | HttpError | ContractError;

/**
 * app.ts is inconsistent about the error envelope: Fastify's own schema
 * validation failures (400s, before any handler runs) use `.message`;
 * every hand-thrown error in the route handlers (404/423/500) uses `.error`.
 * This checks both rather than assuming one. Worth unifying server-side
 * at some point — noting it here rather than silently working around it.
 */
export function extractServerMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return b.error;
  return null;
}