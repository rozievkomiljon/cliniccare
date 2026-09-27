/**
 * Typed application errors. Server Actions and Route Handlers return these as
 * user-safe messages; unexpected errors are logged server-side, never leaked.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "BAD_REQUEST";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You must be signed in.") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, { status: 403, code: "FORBIDDEN" });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super(message, { status: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict with existing data.") {
    super(message, { status: 409, code: "CONFLICT" });
    this.name = "ConflictError";
  }
}

export type ActionError = {
  ok: false;
  error: string;
  code: string;
};

export type ActionSuccess<T> = { ok: true; data: T };

export type ActionResult<T> = ActionSuccess<T> | ActionError;

export function toActionError(err: unknown): ActionError {
  if (err instanceof AppError) {
    return { ok: false, error: err.message, code: err.code };
  }
  // Unexpected errors: log server-side, return a generic message.
  console.error("[unhandled]", err);
  return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
}
