import type { ErrorCode } from '@foundation/contracts/enums';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_mismatch: 422,
  stale_generation: 409,
  review_final: 409,
  build_too_old: 426,
  rate_limited: 429,
  payload_too_large: 413,
  retry_later: 503,
  not_configured: 503,
  purchases_disabled: 403,
  internal: 500,
};

/** One error envelope {error, message?, correlationId, details?}; domain soft outcomes are 200 + disposition. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown, status?: number) {
    super(message ?? code);
    this.code = code;
    this.status = status ?? STATUS[code];
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}
