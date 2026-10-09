import { spawn } from "node:child_process";
import { ConfigurationError, DependencyUnavailableError, OperationCancelledError, RuntimeError, UsageError } from "./errors.js";
import { validateConfig, type AuthyConfig } from "./config.js";
import { validateWorkspaceInput } from "./workspace.js";
import type { AccountListInput, AccountListResult, AccountSummary } from "./storage.js";
import { createAuthyService, type AuthyEvent, type AuthyService, type EventSink, type ExecuteInput, type ExecuteResult, type LoginInput, type LoginResult, type LogoutInput, type LogoutResult, type StatusResult } from "./service.js";

export interface ApiAuthyClientConfig { backend: "api"; baseUrl: string; fetch?: typeof fetch; }
export interface DirectAuthyClientConfig { backend?: "direct"; config?: Partial<AuthyConfig>; service?: AuthyService; }
export interface CliAuthyClientConfig { backend: "cli"; command?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv; }
export type AuthyClientConfig = ApiAuthyClientConfig | DirectAuthyClientConfig | CliAuthyClientConfig;

interface ClientBackend {
  login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult>; logout(input: LogoutInput): Promise<LogoutResult>;
  listAccounts(input?: AccountListInput): Promise<AccountListResult>; getAccountSummary(input?: { count?: boolean; activeAccountId?: boolean }): Promise<AccountSummary>;
  getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult>; execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult>;
}
interface ApiSuccess<T> { ok: true; data: T; }
interface ApiFailure { ok: false; error: { code: string; message: string }; }

/** A transport-neutral client for the Authy engine. Defaults to direct execution. */
export class AuthyClient implements ClientBackend {
  readonly accounts = { list: (input: AccountListInput = {}) => this.listAccounts(input), summary: (input: { count?: boolean; activeAccountId?: boolean } = {}) => this.getAccountSummary(input), status: (input: { accountId: string; signal?: AbortSignal }) => this.getAccountStatus(input.accountId, input.signal) };
  private readonly delegate: ClientBackend;
  constructor(config: AuthyClientConfig = {}) {
    if (!config.backend || config.backend === "direct") this.delegate = config.service ?? createAuthyService(validateConfig(config.config));
    else if (config.backend === "api") this.delegate = new ApiBackend(config);
    else if (config.backend === "cli") this.delegate = new CliBackend(config);
    else throw new ConfigurationError("backend must be direct, cli, or api.");
  }
  login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult> { return this.delegate.login(input, onEvent); }
  logout(input: LogoutInput): Promise<LogoutResult> { return this.delegate.logout(input); }
  listAccounts(input: AccountListInput = {}): Promise<AccountListResult> { return this.delegate.listAccounts(input); }
  getAccountSummary(input: { count?: boolean; activeAccountId?: boolean } = {}): Promise<AccountSummary> { return this.delegate.getAccountSummary(input); }
  getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult> { return this.delegate.getAccountStatus(accountId, signal); }
  execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult> { validateWorkspaceInput(input); return this.delegate.execute(input, onEvent); }
}

class ApiBackend implements ClientBackend {
  private readonly baseUrl: string; private readonly requestFetch: typeof fetch;
  constructor(config: ApiAuthyClientConfig) {
    try { const url = new URL(config.baseUrl); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol"); this.baseUrl = url.toString().replace(/\/$/, ""); }
    catch (error) { throw new ConfigurationError("baseUrl must be an absolute HTTP(S) URL.", { cause: error }); }
    this.requestFetch = config.fetch ?? fetch;
  }
  login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult> { return this.stream("/v1/login", { headless: input.headless, apiKeyEnv: input.apiKeyEnv, displayName: input.displayName }, input.signal, onEvent); }
  logout(input: LogoutInput): Promise<LogoutResult> { return this.json(`/v1/accounts/${encodeURIComponent(input.accountId)}`, { method: "DELETE", signal: input.signal }); }
  listAccounts(input: AccountListInput = {}): Promise<AccountListResult> { return this.json(`/v1/accounts${query({ skip: input.skip, take: input.take, filter: input.filter })}`); }
  getAccountSummary(input: { count?: boolean; activeAccountId?: boolean } = {}): Promise<AccountSummary> { return this.json(`/v1/accounts/summary${query(input)}`); }
  getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult> { return this.json(`/v1/accounts/${encodeURIComponent(accountId)}/status`, { signal }); }
  execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult> { return this.stream("/v1/exec", { accountId: input.accountId, prompt: input.prompt, detailLevel: input.detailLevel, timeoutMs: input.timeoutMs, workspace: input.workspace, readonly: input.readonly }, input.signal, onEvent); }
  private async json<T>(path: string, init: RequestInit = {}): Promise<T> { const value = await jsonResponse<T>(await this.fetch(path, init)); if (!value.ok) throw apiError(value.error); return value.data; }
  private async stream<T>(path: string, body: Record<string, unknown>, signal: AbortSignal | undefined, onEvent?: EventSink): Promise<T> {
    const response = await this.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) { const value = await jsonResponse<never>(response); if (!value.ok) throw apiError(value.error); throw new RuntimeError("The API returned an invalid response."); }
    if (!response.body) throw new DependencyUnavailableError("The API did not provide an event stream.");
    let buffer = ""; const decoder = new TextDecoder();
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) { buffer += decoder.decode(chunk, { stream: true }); let boundary: number; while ((boundary = buffer.indexOf("\n\n")) >= 0) { const parsed = sseFrame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); if (!parsed) continue; if (parsed.event === "result") return JSON.parse(parsed.data) as T; if (parsed.event === "error") throw apiError(JSON.parse(parsed.data) as ApiFailure["error"]); onEvent?.({ event: parsed.event as AuthyEvent["event"], data: JSON.parse(parsed.data) as Record<string, unknown> }); } }
    throw new DependencyUnavailableError("The API event stream ended without a result.");
  }
  private async fetch(path: string, init: RequestInit): Promise<Response> { try { return await this.requestFetch(`${this.baseUrl}${path}`, init); } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new OperationCancelledError("The operation was cancelled.", { cause: error }); throw new DependencyUnavailableError("The Authy API is unavailable.", { cause: error }); } }
}

class CliBackend implements ClientBackend {
  constructor(private readonly config: CliAuthyClientConfig) {}
  login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult> { return this.run(["login", ...(input.headless ? ["--headless"] : []), ...(input.apiKeyEnv ? ["--api-key-env", input.apiKeyEnv] : []), ...(input.displayName ? ["--display-name", input.displayName] : [])], input.signal, onEvent); }
  logout(input: LogoutInput): Promise<LogoutResult> { return this.run(["logout", "--account-id", input.accountId], input.signal); }
  listAccounts(input: AccountListInput = {}): Promise<AccountListResult> { return this.run(["accounts", "list", ...(input.skip !== undefined ? ["--skip", String(input.skip)] : []), ...(input.take !== undefined ? ["--take", String(input.take)] : []), ...(input.filter ? ["--filter", input.filter] : [])]); }
  getAccountSummary(input: { count?: boolean; activeAccountId?: boolean } = {}): Promise<AccountSummary> { return this.run(["accounts", "summary", ...(input.count ? ["--count"] : []), ...(input.activeAccountId ? ["--active-account-id"] : [])]); }
  getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult> { return this.run(["accounts", "status", "--account-id", accountId], signal); }
  execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult> { return this.run(["exec", "--account-id", input.accountId, "--prompt", input.prompt, ...(input.detailLevel ? ["--detail-level", input.detailLevel] : []), ...(input.timeoutMs !== undefined ? ["--timeout-ms", String(input.timeoutMs)] : []), ...(input.workspace !== undefined ? ["--workspace", input.workspace] : []), ...(input.readonly ? ["--readonly"] : [])], input.signal, onEvent); }
  private run<T>(args: string[], signal?: AbortSignal, onEvent?: EventSink): Promise<T> {
    if (signal?.aborted) return Promise.reject(new OperationCancelledError("The operation was cancelled."));
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.command ?? "authy", [...(this.config.args ?? []), ...args], { cwd: this.config.cwd, env: this.config.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "", result: T | undefined, failure: Error | undefined;
      const consume = (chunk: Buffer, errorChannel: boolean) => { const combined = (errorChannel ? stderr : stdout) + chunk.toString("utf8"); const lines = combined.split("\n"); if (errorChannel) stderr = lines.pop() ?? ""; else stdout = lines.pop() ?? ""; for (const line of lines) if (line) { try { const value = JSON.parse(line) as (ApiSuccess<T> & { event?: string }) | ApiFailure; if (!value.ok) failure = apiError(value.error); else if (value.event) onEvent?.({ event: value.event as AuthyEvent["event"], data: value.data as Record<string, unknown> }); else result = value.data; } catch { failure = new DependencyUnavailableError("The Authy CLI returned invalid JSON Lines."); } } };
      child.stdout.on("data", (chunk: Buffer) => consume(chunk, false)); child.stderr.on("data", (chunk: Buffer) => consume(chunk, true));
      const cancel = () => { child.kill(); reject(new OperationCancelledError("The operation was cancelled.")); };
      signal?.addEventListener("abort", cancel, { once: true }); child.once("error", (error) => reject(new DependencyUnavailableError("The Authy CLI is unavailable.", { cause: error })));
      child.once("close", (code) => { signal?.removeEventListener("abort", cancel); if (failure) return reject(failure); if (code !== 0) return reject(new RuntimeError("The Authy CLI did not complete successfully.")); if (result === undefined) return reject(new DependencyUnavailableError("The Authy CLI returned no result.")); resolve(result); });
    });
  }
}

function query(input: Record<string, unknown>): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value)); return params.size ? `?${params}` : ""; }
async function jsonResponse<T>(response: Response): Promise<ApiSuccess<T> | ApiFailure> { try { const value: unknown = await response.json(); if (!value || typeof value !== "object" || !("ok" in value)) throw new Error("Invalid envelope"); return value as ApiSuccess<T> | ApiFailure; } catch (error) { throw new DependencyUnavailableError("The Authy API returned an invalid JSON response.", { cause: error }); } }
function sseFrame(frame: string): { event: string; data: string } | undefined { const event = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7); const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6); return event && data !== undefined ? { event, data } : undefined; }
function apiError(error: ApiFailure["error"]): Error { const constructors: Record<string, (message: string) => Error> = { INVALID_USAGE: (message) => new UsageError(message), INVALID_CONFIGURATION: (message) => new ConfigurationError(message), DEPENDENCY_UNAVAILABLE: (message) => new DependencyUnavailableError(message), OPERATION_CANCELLED: (message) => new OperationCancelledError(message), RUNTIME_ERROR: (message) => new RuntimeError(message) }; return (constructors[error.code] ?? constructors.RUNTIME_ERROR)(error.message); }
