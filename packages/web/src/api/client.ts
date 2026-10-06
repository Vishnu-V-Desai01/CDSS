import { NetworkError, HttpError, ContractError } from './errors';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const TIMEOUT_MS = 5000;

type Method = 'GET' | 'POST' | 'PATCH';

type Validator<T> = (value: unknown) => T;

interface RequestOptions<T> {
  method: Method;
  path: string;
  body?: unknown;
  validate: Validator<T>;
}

export async function request<T>(options: RequestOptions<T>): Promise<T> {
  const { method, path, body, validate } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new NetworkError(cause);
  } finally {
    clearTimeout(timer);
  }

  const raw: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const requestId =
      raw && typeof raw === 'object' && 'request_id' in raw
        ? String((raw as Record<string, unknown>).request_id)
        : undefined;
    throw new HttpError(response.status, raw, requestId);
  }

  try {
    return validate(raw);
  } catch (e) {
    throw new ContractError(e instanceof Error ? e.message : 'unknown', raw);
  }
}