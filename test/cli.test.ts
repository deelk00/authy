import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCli, type CliIo } from "../src/cli.js";
import type { AuthyService } from "../src/service.js";
import { ConfigurationError, DependencyUnavailableError, OperationCancelledError, RuntimeError } from "../src/errors.js";
function output(): { io: CliIo; stdout: string[]; stderr: string[] } { const stdout: string[] = [], stderr: string[] = []; return { stdout, stderr, io: { stdout: { write: (v) => (stdout.push(v), true) }, stderr: { write: (v) => (stderr.push(v), true) } } }; }
const service: AuthyService = { login: async () => ({ accountId: "ada" }), logout: async () => ({ accountId: "ada", loggedOut: true }), listAccounts: async () => ({ accounts: [], total: 0, skip: 0, take: 25 }), getAccountSummary: async () => ({ count: 0 }), getAccountStatus: async () => ({ accountId: "ada", subscription: "active", checkedAt: "2026-01-01T00:00:00.000Z", cached: false, tokenUsage: null, rateLimits: null }), execute: async () => ({ requestId: "request", accountId: "ada", exitCode: 0, output: "" }) };
describe("authy CLI", () => {
  it("writes successful data and a human-readable JSON message to stdout", async () => { const result = output(); assert.equal(await runCli(["accounts", "list"], result.io, service), 0); assert.deepEqual(result.stderr, []); assert.deepEqual(JSON.parse(result.stdout[0]), { ok: true, message: "Accounts loaded successfully.", data: { accounts: [], total: 0, skip: 0, take: 25 } }); });
  it("formats CLI output as one JSON Lines record", async () => { const result = output(); await runCli(["accounts", "list"], result.io, service); assert.match(result.stdout[0], /^\{"ok":true,/); assert.equal(result.stdout[0].split("\n").filter(Boolean).length, 1); });
  it("renders Commander help as plain text on stdout", async () => { const result = output(); assert.equal(await runCli(["exec", "--help"], result.io, service), 0); assert.equal(result.stderr.length, 0); assert.equal(result.stdout.length, 1); assert.match(result.stdout[0], /^Usage: authy exec \[options\]/); assert.match(result.stdout[0], /Runs a Codex task/); assert.doesNotMatch(result.stdout[0], /^\{/); });
  it("explains invalid usage in English via stderr JSONL", async () => { const result = output(); assert.equal(await runCli(["exec", "--account-id", "ada"], result.io, service), 2); assert.equal(result.stdout.length, 0); const error = JSON.parse(result.stderr[0]).error; assert.equal(error.code, "INVALID_USAGE"); assert.equal(error.message, "The required option --prompt <text> is missing."); });
  it("writes typed stream events without duplicating them in the completion result", async () => { const result = output(); const streamingService: AuthyService = { ...service, execute: async (_input, onEvent) => { onEvent?.({ event: "exec.turn.started", data: { threadId: "thread_1" } }); return { requestId: "request", accountId: "ada", exitCode: 0, output: "Final answer." }; } }; assert.equal(await runCli(["exec", "--account-id", "ada", "--prompt", "test", "--detail-level", "turns"], result.io, streamingService), 0); assert.equal(result.stdout.length, 2); assert.equal(JSON.parse(result.stdout[0]).event, "exec.turn.started"); assert.deepEqual(JSON.parse(result.stdout[0]).data, { threadId: "thread_1" }); assert.deepEqual(JSON.parse(result.stdout[1]).data, { requestId: "request", accountId: "ada", exitCode: 0, output: "Final answer." }); });
  it("writes the complete execution result for end-detail execution", async () => { const result = output(); assert.equal(await runCli(["exec", "--account-id", "ada", "--prompt", "test", "--detail-level", "end"], result.io, service), 0); assert.equal(result.stdout.length, 1); assert.deepEqual(JSON.parse(result.stdout[0]).data, { requestId: "request", accountId: "ada", exitCode: 0, output: "" }); });
  it("starts the API server with the configured defaults", async () => { const result = output(); let options: unknown; assert.equal(await runCli(["serve"], result.io, service, (_service, input) => ({ listen: async () => (options = input, { host: "127.0.0.1", port: 8787 }), close: async () => undefined })), 0); assert.deepEqual(options, { host: "127.0.0.1", port: 8787 }); assert.deepEqual(JSON.parse(result.stdout[0]).data, { host: "127.0.0.1", port: 8787 }); });
  it("rejects external API bindings", async () => { const result = output(); assert.equal(await runCli(["serve", "--host", "0.0.0.0"], result.io, service), 2); assert.equal(JSON.parse(result.stderr[0]).error.code, "INVALID_USAGE"); });
});

describe("CLI JSON formatting", () => {
  it("passes workspace and readonly options to exec without changing the result format", async () => {
    const result = output();
    let received: Parameters<AuthyService["execute"]>[0] | undefined;
    const capturingService: AuthyService = { ...service, execute: async (input) => {
      received = input;
      return { requestId: "request", accountId: "ada", exitCode: 0, output: "Done." };
    } };
    assert.equal(await runCli(["exec", "--account-id", "ada", "--prompt", "test", "--workspace", "C:\\Projects\\my repo", "--readonly"], result.io, capturingService), 0);
    assert.equal(received?.workspace, "C:\\Projects\\my repo");
    assert.equal(received?.readonly, true);
    assert.equal(result.stdout[0], `${JSON.stringify(JSON.parse(result.stdout[0]))}\n`);
    assert.deepEqual(result.stderr, []);
  });

  it("rejects a missing workspace argument on stderr with exit code 2", async () => {
    const result = output();
    assert.equal(await runCli(["exec", "--account-id", "ada", "--prompt", "test", "--workspace"], result.io, service), 2);
    assert.deepEqual(result.stdout, []);
    assert.equal(result.stderr.length, 1);
    assert.equal(JSON.parse(result.stderr[0]).error.code, "INVALID_USAGE");
  });
  const commands = [
    ["login"],
    ["logout", "--account-id", "ada"],
    ["accounts", "list"],
    ["accounts", "summary"],
    ["accounts", "status", "--account-id", "ada"],
    ["exec", "--account-id", "ada", "--prompt", "test"],
    ["serve"]
  ];

  for (const args of commands) {
    it(`keeps ${args.join(" ")} compact by default and formats it on request`, async () => {
      const compact = output();
      const formatted = output();
      const serverFactory = () => ({
        listen: async () => ({ host: "127.0.0.1", port: 8787 }),
        close: async () => undefined
      });
      assert.equal(await runCli(args, compact.io, service, serverFactory), 0);
      assert.equal(await runCli([...args, "--formatted"], formatted.io, service, serverFactory), 0);
      assert.deepEqual(compact.stderr, []);
      assert.deepEqual(formatted.stderr, []);
      assert.equal(compact.stdout.length, 1);
      assert.equal(formatted.stdout.length, 1);
      const value = JSON.parse(compact.stdout[0]);
      assert.equal(compact.stdout[0], `${JSON.stringify(value)}\n`);
      assert.equal(formatted.stdout[0], `${JSON.stringify(value, null, 2)}\n`);
    });
  }

  for (const args of [
    ["--formatted", "accounts", "list"],
    ["accounts", "--formatted", "list"]
  ]) {
    it(`accepts the global option in ${args.join(" ")}`, async () => {
      const result = output();
      assert.equal(await runCli(args, result.io, service), 0);
      assert.match(result.stdout[0], /^\{\n  "ok": true,/);
    });
  }

  it("formats every streamed event and the completion result", async () => {
    const streamingService: AuthyService = {
      ...service,
      execute: async (_input, onEvent) => {
        onEvent?.({ event: "exec.turn.started", data: { threadId: "thread_1" } });
        onEvent?.({ event: "exec.turn.completed", data: { threadId: "thread_1" } });
        return { requestId: "request", accountId: "ada", exitCode: 0, output: "Done.\nNext line." };
      }
    };
    for (const formatted of [false, true]) {
      const result = output();
      assert.equal(await runCli([
        "exec", "--account-id", "ada", "--prompt", "test", "--detail-level", "turns",
        ...(formatted ? ["--formatted"] : [])
      ], result.io, streamingService), 0);
      assert.deepEqual(result.stderr, []);
      assert.equal(result.stdout.length, 3);
      for (const record of result.stdout) {
        assert.equal(record, `${JSON.stringify(JSON.parse(record), null, formatted ? 2 : undefined)}\n`);
      }
    }
  });

  for (const args of [
    ["exec", "--formatted"],
    ["accounts", "list", "--skip", "invalid", "--formatted"],
    ["accounts", "list", "--unknown", "--formatted"]
  ]) {
    it(`formats usage errors for ${args.join(" ")}`, async () => {
      const result = output();
      assert.equal(await runCli(args, result.io, service), 2);
      assert.deepEqual(result.stdout, []);
      assert.equal(result.stderr.length, 1);
      const value = JSON.parse(result.stderr[0]);
      assert.equal(value.error.code, "INVALID_USAGE");
      assert.equal(result.stderr[0], `${JSON.stringify(value, null, 2)}\n`);
    });
  }

  for (const error of [
    new RuntimeError(),
    new ConfigurationError("Missing configuration."),
    new DependencyUnavailableError("Docker is unavailable."),
    new OperationCancelledError("Timed out."),
    new Error("private technical details")
  ]) {
    it(`preserves stderr and the exit code for ${error.name} in both formats`, async () => {
      const failingService: AuthyService = { ...service, listAccounts: async () => { throw error; } };
      for (const formatted of [false, true]) {
        const result = output();
        assert.equal(await runCli(["accounts", "list", ...(formatted ? ["--formatted"] : [])], result.io, failingService),
          "exitCode" in error ? error.exitCode : 1);
        assert.deepEqual(result.stdout, []);
        assert.equal(result.stderr.length, 1);
        assert.equal(result.stderr[0], `${JSON.stringify(JSON.parse(result.stderr[0]), null, formatted ? 2 : undefined)}\n`);
        assert.doesNotMatch(result.stderr[0], /private technical details/);
      }
    });
  }

  it("does not treat an option after -- as a formatting request", async () => {
    const result = output();
    assert.equal(await runCli(["accounts", "list", "--", "--formatted"], result.io, service), 2);
    assert.equal(result.stderr[0], `${JSON.stringify(JSON.parse(result.stderr[0]))}\n`);
  });

  it("shows the global option in nested command help", async () => {
    const result = output();
    assert.equal(await runCli(["accounts", "list", "--help"], result.io, service), 0);
    assert.match(result.stdout.join(""), /--formatted/);
  });
});
