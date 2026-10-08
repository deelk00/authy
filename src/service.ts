import { ConfigurationError, DependencyUnavailableError, OperationCancelledError, UsageError } from "./errors.js";
import { type AuthyConfig, type DetailLevel, validateAccountId, validateDetailLevel } from "./config.js";
import { type AccountListInput, type AccountListResult, type AccountRepository, type AccountSummary, FileAccountRepository, FileArtifactRepository } from "./storage.js";
import { type ExecutionQueue, InMemoryExecutionQueue } from "./queue.js";
import { DockerCodexGateway } from "./docker/codex-gateway.js";

export interface LoginInput { headless?: boolean; apiKeyEnv?: string; displayName?: string; signal?: AbortSignal; }
export interface LoginResult { accountId: string; }
export interface LoginProgress { url: string; code: string; }
export interface LogoutInput { accountId: string; signal?: AbortSignal; }
export interface LogoutResult { accountId: string; loggedOut: true; }
export interface TokenUsageDailyBucket { startDate: string; tokens: number; }
export interface TokenUsage { lifetimeTokens: number | null; peakDailyTokens: number | null; longestRunningTurnSeconds: number | null; currentStreakDays: number | null; longestStreakDays: number | null; daily: TokenUsageDailyBucket[] | null; }
export interface RateLimitWindow { usedPercent: number; resetsAt: string | null; windowDurationMinutes: number | null; }
export interface RateLimit { id: string | null; name: string | null; plan: string | null; primary: RateLimitWindow | null; secondary: RateLimitWindow | null; }
export interface StatusResult { accountId: string; subscription: "active" | "inactive" | "unknown"; checkedAt: string; cached: boolean; tokenUsage: TokenUsage | null; rateLimits: RateLimit[] | null; }
export interface ExecuteInput { accountId: string; prompt: string; detailLevel?: DetailLevel; timeoutMs?: number; signal?: AbortSignal; }
export interface ExecuteResult { requestId: string; accountId: string; exitCode: number; output: string; }
export interface ExecuteOutputEvent { type: string; data: Record<string, unknown>; }
export type AuthyEventName = "login.started" | "login.progress" | "login.completed" | "logout.completed" | "exec.started" | "exec.completed" | `exec.${string}`;
export interface AuthyEvent { event: AuthyEventName; data: Record<string, unknown>; }
export type EventSink = (event: AuthyEvent) => void;

export interface CodexGateway {
  login(input: { headless: boolean; apiKey?: string; signal?: AbortSignal }, onProgress: (progress: LoginProgress) => void): Promise<{ accountId: string; artifacts: ReadonlyMap<string, Uint8Array> }>;
  logout(accountId: string, signal?: AbortSignal): Promise<void>;
  execute(input: { accountId: string; prompt: string; detailLevel: DetailLevel; timeoutMs: number; signal?: AbortSignal }, onOutput: (event: ExecuteOutputEvent) => void): Promise<{ exitCode: number; output: string }>;
  getStatus(accountId: string, signal?: AbortSignal): Promise<Omit<StatusResult, "accountId" | "cached">>;
}
class UnavailableCodexGateway implements CodexGateway {
  private unavailable(): never { throw new DependencyUnavailableError("Codex runtime is unavailable."); }
  login(): Promise<never> { return Promise.reject(this.unavailable()); } logout(): Promise<never> { return Promise.reject(this.unavailable()); }
  execute(): Promise<never> { return Promise.reject(this.unavailable()); } getStatus(): Promise<never> { return Promise.reject(this.unavailable()); }
}
export interface AuthyService {
  login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult>; logout(input: LogoutInput, onEvent?: EventSink): Promise<LogoutResult>;
  listAccounts(input?: AccountListInput): Promise<AccountListResult>; getAccountSummary(): Promise<AccountSummary>;
  getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult>; execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult>;
}
export interface AuthyServiceDependencies { config: AuthyConfig; accounts: AccountRepository; artifacts: FileArtifactRepository; queue: ExecutionQueue<ExecuteInput>; codex?: CodexGateway; now?: () => Date; }
export class DefaultAuthyService implements AuthyService {
  private readonly codex: CodexGateway; private readonly now: () => Date; private readonly statusCache = new Map<string, { until: number; value: StatusResult }>();
  constructor(private readonly deps: AuthyServiceDependencies) { this.codex = deps.codex ?? new UnavailableCodexGateway(); this.now = deps.now ?? (() => new Date()); }
  async login(input: LoginInput, onEvent?: EventSink): Promise<LoginResult> {
    if (input.headless && input.apiKeyEnv) throw new UsageError("headless and apiKeyEnv cannot be used together."); if (input.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.apiKeyEnv)) throw new UsageError("apiKeyEnv must name an environment variable.");
    const apiKey = input.apiKeyEnv ? process.env[input.apiKeyEnv] : undefined; if (input.apiKeyEnv && !apiKey) throw new ConfigurationError("The configured API key environment variable is missing."); if (input.signal?.aborted) throw new OperationCancelledError("The operation was cancelled.");
    onEvent?.({ event: "login.started", data: {} }); const result = await this.codex.login({ headless: input.headless ?? false, apiKey, signal: input.signal }, (progress) => onEvent?.({ event: "login.progress", data: { url: progress.url, code: progress.code } }));
    validateAccountId(result.accountId); await this.deps.artifacts.save(result.accountId, result.artifacts); try { const timestamp = this.now().toISOString(); await this.deps.accounts.save({ accountId: result.accountId, displayName: input.displayName, createdAt: timestamp, lastUsedAt: timestamp }); } catch (error) { await this.deps.artifacts.remove(result.accountId); throw error; } onEvent?.({ event: "login.completed", data: { accountId: result.accountId } }); return { accountId: result.accountId };
  }
  async logout(input: LogoutInput, onEvent?: EventSink): Promise<LogoutResult> { const accountId = validateAccountId(input.accountId); if (!(await this.deps.accounts.get(accountId))) throw new ConfigurationError("The requested account does not exist."); await this.codex.logout(accountId, input.signal); await this.deps.artifacts.remove(accountId); await this.deps.accounts.remove(accountId); this.statusCache.delete(accountId); const result = { accountId, loggedOut: true as const }; onEvent?.({ event: "logout.completed", data: result }); return result; }
  listAccounts(input: AccountListInput = {}): Promise<AccountListResult> { return this.deps.accounts.list(input); }
  async getAccountSummary(): Promise<AccountSummary> { const list = await this.deps.accounts.list({ skip: 0, take: this.deps.config.maxListTake }); return { count: list.total }; }
  async getAccountStatus(accountId: string, signal?: AbortSignal): Promise<StatusResult> { accountId = validateAccountId(accountId); if (!(await this.deps.accounts.get(accountId))) throw new ConfigurationError("The requested account does not exist."); const cached = this.statusCache.get(accountId); if (cached && cached.until > Date.now()) return { ...cached.value, cached: true }; const result = await this.codex.getStatus(accountId, signal); const value = { accountId, ...result, cached: false }; this.statusCache.set(accountId, { until: Date.now() + this.deps.config.statusCacheTtlMs, value }); return value; }
  async execute(input: ExecuteInput, onEvent?: EventSink): Promise<ExecuteResult> { const accountId = validateAccountId(input.accountId); if (!(await this.deps.accounts.get(accountId))) throw new ConfigurationError("The requested account does not exist."); if (!input.prompt || input.prompt.trim().length > 100_000) throw new UsageError("prompt must contain between 1 and 100000 characters."); const detailLevel = validateDetailLevel(input.detailLevel ?? "end"), timeoutMs = input.timeoutMs ?? this.deps.config.defaultTimeoutMs; if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new UsageError("timeoutMs must be a positive integer."); const lease = await this.deps.queue.enqueue(accountId, { ...input, accountId, detailLevel, timeoutMs }, input.signal); try { const result = await this.codex.execute({ accountId, prompt: input.prompt, detailLevel, timeoutMs, signal: input.signal }, (event) => onEvent?.({ event: execEventName(event.type), data: { requestId: lease.job.requestId, accountId, ...event.data, ...(isKnownExecEvent(event.type) ? {} : { sourceType: event.type }) } })); const output = { requestId: lease.job.requestId, accountId, ...result }; lease.complete(); return output; } catch (error) { lease.fail(); throw error; } }
}

function execEventName(type: string): AuthyEventName {
  const direct: Record<string, AuthyEventName> = {
    "turn.started": "exec.turn.started",
    "turn.completed": "exec.turn.completed",
    "reasoning.summary": "exec.reasoning.summary",
    final: "exec.final"
  };
  if (direct[type]) return direct[type];
  const item = /^item\.(started|completed)\.(command|file_change|tool)$/.exec(type);
  return item ? `exec.${item[2]}.${item[1]}` : "exec.event";
}

function isKnownExecEvent(type: string): boolean {
  return execEventName(type) !== "exec.event";
}
export function createAuthyService(config: AuthyConfig, overrides: Partial<Omit<AuthyServiceDependencies, "config" | "accounts" | "artifacts" | "queue">> & { accounts?: AccountRepository; artifacts?: FileArtifactRepository; queue?: ExecutionQueue<ExecuteInput> } = {}): AuthyService { const accounts = overrides.accounts ?? new FileAccountRepository(config.storageDirectory, config.maxListTake); return new DefaultAuthyService({ config, accounts, artifacts: overrides.artifacts ?? new FileArtifactRepository(config.storageDirectory, config.authArtifacts, config.maxArtifactBytes), queue: overrides.queue ?? new InMemoryExecutionQueue(config.leaseMs, config.queueWindowMs), codex: overrides.codex ?? new DockerCodexGateway(config), now: overrides.now }); }
