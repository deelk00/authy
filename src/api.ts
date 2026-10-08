import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { asAppError, DependencyUnavailableError, UsageError } from "./errors.js";
import type { AccountListInput } from "./storage.js";
import type { AuthyEvent, AuthyService, ExecuteInput, LoginInput } from "./service.js";

export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 8787;
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

export interface AuthyApiServerOptions {
  host?: string;
  port?: number;
  bodyLimitBytes?: number;
}

export interface AuthyApiServer {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host.toLowerCase() === "localhost";
}

export function createAuthyApiServer(
  service: AuthyService,
  options: AuthyApiServerOptions = {}
): AuthyApiServer {
  const host = options.host ?? DEFAULT_API_HOST;
  const port = options.port ?? DEFAULT_API_PORT;
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!isLoopbackHost(host)) throw new UsageError("host must be a loopback address.");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new UsageError("port must be an integer between 0 and 65535.");
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes < 1) throw new UsageError("bodyLimitBytes must be a positive integer.");

  const server = createServer((request, response) => {
    void handleRequest(service, request, response, bodyLimitBytes).catch((error) => writeError(response, error));
  });
  let shutdownAttached = false;

  return {
    async listen(): Promise<{ host: string; port: number }> {
      await listen(server, host, port);
      if (!shutdownAttached) {
        shutdownAttached = true;
        const shutdown = () => { void close(server); };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
      }
      const address = server.address();
      if (!address || typeof address === "string") throw new DependencyUnavailableError("The API server did not expose a network address.");
      return { host, port: address.port };
    },
    close: () => close(server)
  };
}

async function handleRequest(service: AuthyService, request: IncomingMessage, response: ServerResponse, bodyLimitBytes: number): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";
  if (method === "POST" && url.pathname === "/v1/login") {
    const input = loginInput(await jsonBody(request, bodyLimitBytes));
    return stream(response, request, (signal, onEvent) => service.login({ ...input, signal }, onEvent));
  }
  if (method === "POST" && url.pathname === "/v1/exec") {
    const input = executeInput(await jsonBody(request, bodyLimitBytes));
    return stream(response, request, (signal, onEvent) => service.execute({ ...input, signal }, onEvent));
  }
  if (method === "GET" && url.pathname === "/v1/accounts") {
    const result = await service.listAccounts(listInput(url.searchParams));
    const idsOnly = optionalBoolean(url.searchParams.get("idsOnly"), "idsOnly");
    return writeSuccess(response, idsOnly ? { ...result, accounts: result.accounts.map((account) => account.accountId) } : result);
  }
  if (method === "GET" && url.pathname === "/v1/accounts/summary") return writeSuccess(response, selectSummary(await service.getAccountSummary(), url.searchParams));

  const statusMatch = /^\/v1\/accounts\/([^/]+)\/status$/.exec(url.pathname);
  if (method === "GET" && statusMatch) return writeSuccess(response, await service.getAccountStatus(decodeURIComponent(statusMatch[1])));
  const accountMatch = /^\/v1\/accounts\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && accountMatch) return writeSuccess(response, await service.logout({ accountId: decodeURIComponent(accountMatch[1]) }));
  throw new UsageError("The requested API route or method is invalid.");
}

async function stream<T>(response: ServerResponse, request: IncomingMessage, operation: (signal: AbortSignal, onEvent: (event: AuthyEvent) => void) => Promise<T>): Promise<void> {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  try {
    const result = await operation(controller.signal, (event) => writeSse(response, event.event, event.data));
    writeSse(response, "result", result);
  } catch (error) {
    const appError = asAppError(error);
    writeSse(response, "error", { code: appError.code, message: appError.message });
  } finally {
    response.end();
  }
}

function writeSse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function listInput(params: URLSearchParams): AccountListInput {
  return {
    skip: optionalInteger(params.get("skip"), "skip"),
    take: optionalInteger(params.get("take"), "take"),
    filter: params.get("filter") ?? undefined
  };
}

function selectSummary(summary: { count: number; activeAccountId?: string }, params: URLSearchParams): Record<string, unknown> {
  const count = optionalBoolean(params.get("count"), "count");
  const activeAccountId = optionalBoolean(params.get("activeAccountId"), "activeAccountId");
  if (!count && !activeAccountId) return summary;
  return { ...(count ? { count: summary.count } : {}), ...(activeAccountId && summary.activeAccountId ? { activeAccountId: summary.activeAccountId } : {}) };
}

function loginInput(body: Record<string, unknown>): LoginInput {
  return {
    headless: optionalValue(body, "headless", "boolean"),
    apiKeyEnv: optionalValue(body, "apiKeyEnv", "string"),
    displayName: optionalValue(body, "displayName", "string")
  };
}

function executeInput(body: Record<string, unknown>): ExecuteInput {
  const accountId = requiredValue(body, "accountId", "string");
  const prompt = requiredValue(body, "prompt", "string");
  const detailLevel = optionalValue(body, "detailLevel", "string");
  const timeoutMs = optionalValue(body, "timeoutMs", "number");
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new UsageError("timeoutMs must be a positive integer.");
  return { accountId, prompt, detailLevel, timeoutMs } as ExecuteInput;
}

function optionalValue<T extends "string" | "number" | "boolean">(body: Record<string, unknown>, name: string, type: T): T extends "string" ? string | undefined : T extends "number" ? number | undefined : boolean | undefined {
  const value = body[name];
  if (value === undefined) return undefined as never;
  if (typeof value !== type) throw new UsageError(`${name} must be a ${type}.`);
  return value as never;
}

function requiredValue(body: Record<string, unknown>, name: string, type: "string"): string {
  const value = optionalValue(body, name, type);
  if (value === undefined) throw new UsageError(`${name} is required.`);
  return value;
}

function optionalInteger(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`${name} must be a non-negative integer.`);
  return Number(value);
}

function optionalBoolean(value: string | null, name: string): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`${name} must be true or false.`);
}

async function jsonBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > limit) throw new UsageError("The JSON request body is too large.");
    chunks.push(value);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new UsageError("The JSON request body must be an object.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("The JSON request body is invalid.", { cause: error });
  }
}

function writeSuccess(response: ServerResponse, data: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: true, data }));
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) return;
  const appError = asAppError(error);
  const status = appError.code === "INVALID_USAGE" || appError.code === "INVALID_CONFIGURATION" ? 400
    : appError.code === "DEPENDENCY_UNAVAILABLE" ? 503
      : appError.code === "OPERATION_CANCELLED" ? 408 : 500;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, error: { code: appError.code, message: appError.message } }));
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
