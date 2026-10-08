export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface AppErrorOptions {
  cause?: unknown;
}

/** Base error for expected application failures. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: ExitCode,
    options: AppErrorOptions = {}
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RuntimeError extends AppError {
  constructor(message = "The operation could not be completed.", options?: AppErrorOptions) {
    super(message, "RUNTIME_ERROR", 1, options);
  }
}

export class UsageError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "INVALID_USAGE", 2, options);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "INVALID_CONFIGURATION", 3, options);
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "DEPENDENCY_UNAVAILABLE", 4, options);
  }
}

export class OperationCancelledError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "OPERATION_CANCELLED", 5, options);
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new RuntimeError(undefined, { cause: error });
}
