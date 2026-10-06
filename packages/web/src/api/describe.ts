import { ContractError, HttpError, NetworkError, extractServerMessage } from './errors';

export interface FatalView {
  title: string;
  message: string;
  detail?: string;
}

/**
 * 4xx replies that mean "the server refused this and changed nothing". The
 * numbers on screen were just confirmed by the server, so they stay.
 * 404 (session gone) and 423 (halted) are handled separately by callers.
 */
export function isRejection(err: unknown): err is HttpError {
  return (
    err instanceof HttpError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 404 &&
    err.status !== 423
  );
}

export function rejectionMessage(err: HttpError): string {
  return extractServerMessage(err.body) ?? `The server rejected the request (HTTP ${err.status}).`;
}

/** The outcome is unknown, so the caller replaces the screen with this. */
export function describeFatal(err: unknown, unreachableMessage: string): FatalView {
  if (err instanceof NetworkError) {
    return { title: 'Backend not reachable', message: unreachableMessage };
  }
  if (err instanceof HttpError) {
    const text = extractServerMessage(err.body) ?? `HTTP ${err.status}`;
    return {
      title: err.status === 404 ? 'Session not found' : 'The server reported an error',
      message: text,
      detail: err.requestId ? `Request ID: ${err.requestId}` : undefined,
    };
  }
  if (err instanceof ContractError) {
    return {
      title: 'Unexpected response from the server',
      message: 'The response did not match the expected format, so nothing is shown.',
      detail: err.detail,
    };
  }
  return { title: 'Unexpected error', message: 'Something went wrong. Retry.' };
}