import { randomUUID } from "node:crypto";
import { type AuthyConfig, type DetailLevel, validateAccountId } from "../config.js";
import {
  DependencyUnavailableError,
  OperationCancelledError,
  RuntimeError
} from "../errors.js";
import type { CodexGateway, ExecuteOutputEvent, LoginProgress, RateLimit, RateLimitWindow, StatusResult, TokenUsage } from "../service.js";
import type { ResolvedWorkspace } from "../workspace.js";
import {
  authyLabels,
  authyContainerName,
  DockerService,
  type CommandOutput
} from "./docker-service.js";

export interface DockerRuntime {
  createVolume(input: { name: string; labels?: Record<string, string> }): Promise<unknown>;
  runEphemeral(
    input: Parameters<DockerService["runEphemeral"]>[0],
    signal?: AbortSignal
  ): Promise<{ containerId: string }>;
  executeCommand(input: Parameters<DockerService["executeCommand"]>[0]): Promise<CommandOutput>;
  removeContainer(containerId: string): Promise<void>;
}

/**
 * Runs Codex in short-lived, non-privileged Docker containers. The Docker
 * client is created lazily so account-list commands continue to work when the
 * daemon is not running.
 */
export class DockerCodexGateway implements CodexGateway {
  private runtime?: Promise<DockerRuntime>;

  constructor(
    private readonly config: AuthyConfig,
    private readonly createRuntime: () => Promise<DockerRuntime> = DockerService.fromDockerConfig
  ) {}

  async login(
    input: { headless: boolean; apiKey?: string; signal?: AbortSignal },
    onProgress: (progress: LoginProgress) => void
  ): Promise<{ accountId: string; artifacts: ReadonlyMap<string, Uint8Array> }> {
    if (input.apiKey) {
      throw new RuntimeError(
        "API-key login is not available with this Docker runtime. Use device authentication instead."
      );
    }

    const accountId = `account-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const requestId = randomUUID();
    const docker = await this.getRuntime();

    await docker.createVolume({
      name: this.config.authVolumeName,
      labels: { "com.authy.managed": "true" }
    });
    await docker.createVolume({
      name: this.config.codexVolumeName,
      labels: { "com.authy.managed": "true" }
    });

    const container = await docker.runEphemeral({
      image: this.config.codexImage,
      name: authyContainerName("login", requestId),
      command: ["sleep", "infinity"],
      environment: [`CODEX_HOME=/codex-auth/${accountId}`],
      labels: authyLabels(requestId, accountId),
      volumes: [
        { source: this.config.authVolumeName, target: "/codex-auth", readOnly: false }
      ],
      networkMode: this.config.networkMode
    }, input.signal);

    try {
      const command = input.headless
        ? ["codex", "login", "--device-auth"]
        : ["codex", "login"];
      let loginOutput = "";
      let reportedDeviceCode: string | undefined;
      const captureOutput = (text: string): void => {
        loginOutput += stripAnsi(text);
        const deviceAuthorization = parseDeviceAuthorization(loginOutput);
        if (deviceAuthorization && deviceAuthorization.code !== reportedDeviceCode) {
          reportedDeviceCode = deviceAuthorization.code;
          onProgress(deviceAuthorization);
        }
      };
      const output = await docker.executeCommand({
        containerId: container.containerId,
        command,
        environment: [`CODEX_HOME=/codex-auth/${accountId}`],
        onStdout: captureOutput,
        onStderr: captureOutput
      });
      assertSuccessfulLogin(output);
      return { accountId, artifacts: new Map() };
    } finally {
      await docker.removeContainer(container.containerId);
    }
  }

  async logout(accountId: string, signal?: AbortSignal): Promise<void> {
    accountId = validateAccountId(accountId);
    const requestId = randomUUID();
    const docker = await this.getRuntime();
    const container = await docker.runEphemeral({
      image: this.config.codexImage,
      name: authyContainerName("logout", requestId),
      command: ["sleep", "infinity"],
      environment: [`CODEX_HOME=/codex-auth/${accountId}`],
      labels: authyLabels(requestId, accountId),
      volumes: [
        { source: this.config.authVolumeName, target: "/codex-auth", readOnly: false }
      ],
      networkMode: "none"
    }, signal);

    try {
      const logout = await docker.executeCommand({
        containerId: container.containerId,
        command: ["codex", "logout"],
        environment: [`CODEX_HOME=/codex-auth/${accountId}`]
      });
      assertSuccessfulCommand(logout, "Codex sign-out did not complete successfully.");

      const cleanup = await docker.executeCommand({
        containerId: container.containerId,
        command: ["rm", "-rf", "--", `/codex-auth/${accountId}`]
      });
      assertSuccessfulCommand(cleanup, "Stored authentication data could not be removed.");
    } finally {
      await docker.removeContainer(container.containerId);
    }
  }

  async execute(
    input: {
      accountId: string;
      prompt: string;
      detailLevel: DetailLevel;
      timeoutMs: number;
      workspace?: ResolvedWorkspace;
      signal?: AbortSignal;
    },
    onOutput: (event: ExecuteOutputEvent) => void
  ): Promise<{ exitCode: number; output: string }> {
    const accountId = validateAccountId(input.accountId);
    const requestId = randomUUID();
    const docker = await this.getRuntime();
    const container = await docker.runEphemeral({
      image: this.config.codexImage,
      name: authyContainerName("exec", requestId),
      command: ["sleep", "infinity"],
      environment: [`CODEX_HOME=/codex-auth/${accountId}`],
      labels: authyLabels(requestId, accountId),
      volumes: [
        { source: this.config.authVolumeName, target: "/codex-auth", readOnly: false },
        ...(input.workspace ? [{
          type: "bind" as const,
          source: input.workspace.source,
          target: "/workspace",
          readOnly: input.workspace.readOnly
        }] : [])
      ],
      networkMode: this.config.networkMode
    }, input.signal);

    try {
      const events = new CodexEventCollector(input.detailLevel, onOutput);
      const command = await docker.executeCommand({
        containerId: container.containerId,
        command: codexExecCommand(input.timeoutMs, input.prompt, input.workspace),
        environment: [`CODEX_HOME=/codex-auth/${accountId}`],
        workingDirectory: "/workspace",
        user: "authy",
        onStdout: (chunk) => events.push(chunk)
      });
      if (!events.receivedStream) events.push(command.stdout);
      events.finish();
      if (command.exitCode === 124) {
        throw new OperationCancelledError("The Codex task timed out.");
      }
      if (command.exitCode !== 0) {
        throw new RuntimeError("Codex task did not complete successfully.");
      }
      return { exitCode: command.exitCode ?? 0, output: events.output() };
    } finally {
      await docker.removeContainer(container.containerId);
    }
  }

  async getStatus(
    accountId: string,
    signal?: AbortSignal
  ): Promise<Omit<StatusResult, "accountId" | "cached">> {
    accountId = validateAccountId(accountId);
    const requestId = randomUUID();
    const docker = await this.getRuntime();
    const container = await docker.runEphemeral({
      image: this.config.codexImage,
      name: authyContainerName("status", requestId),
      command: ["sleep", "infinity"],
      environment: [`CODEX_HOME=/codex-auth/${accountId}`],
      labels: authyLabels(requestId, accountId),
      volumes: [
        { source: this.config.authVolumeName, target: "/codex-auth", readOnly: false }
      ],
      networkMode: this.config.networkMode
    }, signal);

    try {
      const output = await docker.executeCommand({
        containerId: container.containerId,
        command: ["codex", "login", "status"],
        environment: [`CODEX_HOME=/codex-auth/${accountId}`]
      });
      const subscription = statusFromCodexOutput(output);
      if (!subscription) {
        throw new RuntimeError("Codex account-status check did not complete successfully.");
      }
      const usage = await readAccountUsage(docker, container.containerId, accountId);
      return { subscription, checkedAt: new Date().toISOString(), ...usage };
    } finally {
      await docker.removeContainer(container.containerId);
    }
  }

  private getRuntime(): Promise<DockerRuntime> {
    this.runtime ??= this.createRuntime().catch((error) => {
      throw new DependencyUnavailableError("Docker is unavailable.", { cause: error });
    });
    return this.runtime;
  }
}

function assertSuccessfulLogin(output: CommandOutput): void {
  assertSuccessfulCommand(output, "Codex sign-in did not complete successfully.");
}

function assertSuccessfulCommand(output: CommandOutput, message: string): void {
  if (output.exitCode !== 0) throw new RuntimeError(message);
}

function statusFromCodexOutput(
  output: CommandOutput
): "active" | "inactive" | undefined {
  if (output.exitCode === 0) return "active";

  const text = `${output.stdout}\n${output.stderr}`;
  return /\b(not logged in|not authenticated|no credentials?)\b/i.test(text)
    ? "inactive"
    : undefined;
}

async function readAccountUsage(
  docker: DockerRuntime,
  containerId: string,
  accountId: string
): Promise<Pick<StatusResult, "tokenUsage" | "rateLimits">> {
  const output = await docker.executeCommand({
    containerId,
    command: ["sh", "-c", codexUsageRequestScript()],
    environment: [`CODEX_HOME=/codex-auth/${accountId}`]
  });

  // Usage data is supplemental. Older Codex images can lack these experimental
  // RPCs, so a successful sign-in check remains useful in that case.
  if (output.exitCode !== 0) return { tokenUsage: null, rateLimits: null };

  const responses = parseJsonLines(output.stdout);
  return {
    tokenUsage: tokenUsageFromResponse(responses.get(3)),
    rateLimits: rateLimitsFromResponse(responses.get(2))
  };
}

function codexUsageRequestScript(): string {
  const requests = [
    { id: 1, method: "initialize", params: { clientInfo: { name: "authy", version: "1.0.0" }, capabilities: { experimentalApi: true } } },
    { id: 2, method: "account/rateLimits/read", params: null },
    { id: 3, method: "account/usage/read", params: null }
  ].map((request) => JSON.stringify(request));
  return `printf '%s\\n' ${requests.map(quoteForPosixShell).join(" ")} | codex app-server --stdio`;
}

function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function parseJsonLines(output: string): Map<number, unknown> {
  const responses = new Map<number, unknown>();
  for (const line of output.split(/\r?\n/)) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || typeof parsed.id !== "number" || !("result" in parsed)) continue;
      responses.set(parsed.id, parsed.result);
    } catch {
      // App-server notifications and diagnostic output are not status data.
    }
  }
  return responses;
}

function tokenUsageFromResponse(value: unknown): TokenUsage | null {
  if (!isRecord(value) || !isRecord(value.summary)) return null;
  const summary = value.summary;
  const daily = Array.isArray(value.dailyUsageBuckets)
    ? value.dailyUsageBuckets.flatMap((bucket) => isRecord(bucket) && typeof bucket.startDate === "string" && isFiniteNumber(bucket.tokens)
      ? [{ startDate: bucket.startDate, tokens: bucket.tokens }]
      : [])
    : null;
  return {
    lifetimeTokens: nullableNumber(summary.lifetimeTokens),
    peakDailyTokens: nullableNumber(summary.peakDailyTokens),
    longestRunningTurnSeconds: nullableNumber(summary.longestRunningTurnSec),
    currentStreakDays: nullableNumber(summary.currentStreakDays),
    longestStreakDays: nullableNumber(summary.longestStreakDays),
    daily
  };
}

function rateLimitsFromResponse(value: unknown): RateLimit[] | null {
  if (!isRecord(value) || !isRecord(value.rateLimits)) return null;
  const snapshots = isRecord(value.rateLimitsByLimitId)
    ? Object.values(value.rateLimitsByLimitId)
    : [value.rateLimits];
  const limits = snapshots.flatMap((snapshot) => rateLimitFromSnapshot(snapshot));
  return limits.length > 0 ? limits : null;
}

function rateLimitFromSnapshot(value: unknown): RateLimit[] {
  if (!isRecord(value)) return [];
  return [{
    id: nullableString(value.limitId),
    name: nullableString(value.limitName),
    plan: nullableString(value.planType),
    primary: rateLimitWindowFrom(value.primary),
    secondary: rateLimitWindowFrom(value.secondary)
  }];
}

function rateLimitWindowFrom(value: unknown): RateLimitWindow | null {
  if (!isRecord(value) || !isFiniteNumber(value.usedPercent)) return null;
  return {
    usedPercent: value.usedPercent,
    resetsAt: unixSecondsToIso(value.resetsAt),
    windowDurationMinutes: nullableNumber(value.windowDurationMins)
  };
}

function unixSecondsToIso(value: unknown): string | null {
  return isFiniteNumber(value) ? new Date(value * 1_000).toISOString() : null;
}

function nullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codexExecCommand(timeoutMs: number, prompt: string, workspace?: ResolvedWorkspace): string[] {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
  const sandbox = workspace && !workspace.readOnly ? "workspace-write" : "read-only";
  const noFileTools = workspace ? "" : [
    "features.shell_tool=false",
    "features.unified_exec=false",
    "features.apply_patch_freeform=false",
    "features.js_repl=false",
    "features.multi_agent=false",
    "tools.view_image=false"
  ].map((setting) => `-c ${quoteForPosixShell(setting)}`).join(" ");
  return [
    "sh", "-c",
    // Copy only credentials into an ephemeral home, never account config/MCP
    // tools which could bypass the selected filesystem mode.
    'set -eu; authy_credentials="$CODEX_HOME/auth.json"; authy_home=$(mktemp -d /tmp/authy-codex.XXXXXX); cp -- "$CODEX_HOME/auth.json" "$authy_home/auth.json"; export CODEX_HOME="$authy_home"; '
      + `set +e; timeout --signal=TERM "$1" codex --ask-for-approval never exec --json --sandbox ${sandbox} ${noFileTools} --skip-git-repo-check -- "$2"; `
      + 'authy_status=$?; set -e; authy_updated=$(mktemp "${authy_credentials}.XXXXXX"); cp -- "$CODEX_HOME/auth.json" "$authy_updated"; mv -- "$authy_updated" "$authy_credentials"; exit "$authy_status"',
    "authy-exec",
    `${timeoutSeconds}s`,
    prompt
  ];
}

class CodexEventCollector {
  private remainder = "";
  private finalOutput = "";
  receivedStream = false;

  constructor(
    private readonly detailLevel: DetailLevel,
    private readonly onOutput: (event: ExecuteOutputEvent) => void
  ) {}

  push(chunk: string): void {
    this.receivedStream = true;
    this.remainder += chunk;
    const lines = this.remainder.split(/\r?\n/);
    this.remainder = lines.pop() ?? "";
    lines.forEach((line) => this.consume(line));
  }

  finish(): void {
    if (this.remainder) this.consume(this.remainder);
    this.remainder = "";
    if ((this.detailLevel === "turns" || this.detailLevel === "internal") && this.finalOutput) {
      this.onOutput({ type: "final", data: { text: this.finalOutput } });
    }
  }

  output(): string {
    return this.finalOutput;
  }

  private consume(line: string): void {
    try {
      const event: unknown = JSON.parse(line);
      const value = detailValue(event, this.detailLevel);
      if (!value) return;
      if (value.type === "final") {
        this.finalOutput = String(value.data.text ?? "");
        if (this.detailLevel === "verbose") this.onOutput(value);
        return;
      }
      if (this.detailLevel !== "end") this.onOutput(value);
    } catch {
      // Codex --json is JSONL; ignore non-protocol diagnostics on stdout.
    }
  }
}

function detailValue(event: unknown, detailLevel: DetailLevel): ExecuteOutputEvent | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;
  const type = event.type;
  const item = isRecord(event.item) ? event.item : undefined;
  const agentMessage = item && isAgentMessageItem(item) ? agentMessageText(item) : undefined;
  const reasoningSummary = item?.type === "reasoning" ? reasoningSummaryText(item) : undefined;

  if (agentMessage && type === "item.completed") return { type: "final", data: { text: agentMessage } };
  if (detailLevel === "end") return undefined;
  if (detailLevel === "internal") {
    if (reasoningSummary) return { type: "reasoning.summary", data: { text: reasoningSummary } };
    if (item?.type === "reasoning") return undefined;
    if (item?.type === "command_execution") return { type: `${type}.command`, data: eventData(item) };
    if (item?.type === "file_change") return { type: `${type}.file_change`, data: eventData(item) };
    if (item && isToolItem(item)) return { type: `${type}.tool`, data: toolEventData(item) };
    return { type, data: eventData(event) };
  }
  if (detailLevel === "turns") {
    return type === "turn.started" || type === "turn.completed"
      ? { type, data: eventData(event) }
      : undefined;
  }
  if (reasoningSummary) return { type: "reasoning.summary", data: { text: reasoningSummary } };
  if (item?.type === "reasoning") return undefined;
  if (item?.type === "command_execution") return { type: `${type}.command`, data: eventData(item) };
  if (item?.type === "file_change") return { type: `${type}.file_change`, data: eventData(item) };
  if (item && isToolItem(item)) return { type: `${type}.tool`, data: toolEventData(item) };
  return { type, data: eventData(event) };
}

function eventData(value: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...data } = value;
  return data;
}

function isToolItem(item: Record<string, unknown>): boolean {
  if (typeof item.type !== "string") return false;
  return item.type === "mcp_list_tools"
    || item.type === "mcp_call"
    || item.type === "mcp_tool_call"
    || item.type === "tool_call"
    || item.type === "function_call"
    || item.type.endsWith("_tool_call");
}

function toolEventData(item: Record<string, unknown>): Record<string, unknown> {
  const data = eventData(item);
  const resources = resourceEntries(item);
  return resources.length > 0 ? { ...data, resources } : data;
}

/**
 * Preserves a tool's complete raw output and additionally exposes resources in
 * one predictable field. Codex/MCP versions use several equivalent envelopes.
 */
function resourceEntries(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8 || !value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => resourceEntries(entry, depth + 1));
  if (!isRecord(value)) return [];

  const resource = value.type === "resource" || value.type === "resource_link"
    ? [eventData(value)]
    : [];
  const nested = Object.entries(value).flatMap(([key, entry]) => {
    if (key === "resources" && Array.isArray(entry)) {
      return entry.flatMap((resource) => isRecord(resource) ? [resource] : []);
    }
    return key === "type" ? [] : resourceEntries(entry, depth + 1);
  });
  return [...resource, ...nested];
}

function agentMessageText(item: Record<string, unknown>): string | undefined {
  return textFromValue(item.text)
    ?? textFromValue(item.message)
    ?? textFromValue(item.content);
}

function reasoningSummaryText(item: Record<string, unknown>): string | undefined {
  return textFromValue(item.text)
    ?? textFromValue(item.summary)
    ?? textFromValue(item.content);
}

function isAgentMessageItem(item: Record<string, unknown>): boolean {
  return item.type === "agent_message"
    || (item.type === "message" && (item.role === "assistant" || item.role === "agent"));
}

/** Extracts text that Codex explicitly includes in a public JSONL event. */
function textFromValue(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!isRecord(part)) return [];
    return typeof part.text === "string"
      ? [part.text]
      : typeof part.content === "string"
        ? [part.content]
        : [];
  }).filter((part) => part.length > 0);
  return text.length > 0 ? text.join("\n") : undefined;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseDeviceAuthorization(output: string): LoginProgress | undefined {
  const url = /https:\/\/auth\.openai\.com\/[^\s]+/.exec(output)?.[0];
  const code = /one-time code[\s\S]*?\n\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)/i.exec(output)?.[1];
  return url && code ? { url, code } : undefined;
}
