import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import { DockerCodexGateway, type DockerRuntime } from "../src/docker/codex-gateway.js";

describe("DockerCodexGateway", () => {
  it("creates a temporary device-authentication container and reports structured credentials", async () => {
    const volumes: string[] = [];
    let runInput: Parameters<DockerRuntime["runEphemeral"]>[0] | undefined;
    let command: Parameters<DockerRuntime["executeCommand"]>[0] | undefined;
    const removed: string[] = [];
    const runtime: DockerRuntime = {
      createVolume: async ({ name }) => { volumes.push(name); },
      runEphemeral: async (input) => { runInput = input; return { containerId: "login-container" }; },
      executeCommand: async (input) => {
        command = input;
        input.onStdout?.("Open https://auth.openai.com/codex/device\n");
        input.onStdout?.("Enter this one-time code:\n  ABCD-EFGH\n");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      removeContainer: async (containerId) => { removed.push(containerId); }
    };
    const progress: Array<{ url: string; code: string }> = [];
    const gateway = new DockerCodexGateway(defaultConfig(), async () => runtime);

    const result = await gateway.login({ headless: true }, (value) => progress.push(value));

    assert.match(result.accountId, /^account-[a-f0-9]{20}$/);
    assert.deepEqual(volumes, ["authy-auth", "authy-codex"]);
    assert.deepEqual(runInput?.command, ["sleep", "infinity"]);
    assert.match(runInput?.name ?? "", /^authy_login_[a-f0-9]{12}$/);
    assert.equal(runInput?.networkMode, "bridge");
    assert.deepEqual(command?.command, ["codex", "login", "--device-auth"]);
    assert.deepEqual(progress, [{ url: "https://auth.openai.com/codex/device", code: "ABCD-EFGH" }]);
    assert.deepEqual(removed, ["login-container"]);
  });

  it("signs out and removes only the selected account's Docker authentication directory", async () => {
    let runInput: Parameters<DockerRuntime["runEphemeral"]>[0] | undefined;
    const commands: Parameters<DockerRuntime["executeCommand"]>[0][] = [];
    const removed: string[] = [];
    const runtime: DockerRuntime = {
      createVolume: async () => undefined,
      runEphemeral: async (input) => { runInput = input; return { containerId: "logout-container" }; },
      executeCommand: async (input) => {
        commands.push(input);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      removeContainer: async (containerId) => { removed.push(containerId); }
    };
    const gateway = new DockerCodexGateway(defaultConfig(), async () => runtime);

    await gateway.logout("account_42");

    assert.match(runInput?.name ?? "", /^authy_logout_[a-f0-9]{12}$/);
    assert.equal(runInput?.networkMode, "none");
    assert.deepEqual(commands.map((input) => input.command), [
      ["codex", "logout"],
      ["rm", "-rf", "--", "/codex-auth/account_42"]
    ]);
    assert.deepEqual(removed, ["logout-container"]);
  });

  it("checks the selected account with a status container that can fetch live usage", async () => {
    let runInput: Parameters<DockerRuntime["runEphemeral"]>[0] | undefined;
    const commands: Parameters<DockerRuntime["executeCommand"]>[0][] = [];
    const removed: string[] = [];
    const runtime: DockerRuntime = {
      createVolume: async () => undefined,
      runEphemeral: async (input) => { runInput = input; return { containerId: "status-container" }; },
      executeCommand: async (input) => {
        commands.push(input);
        if (input.command[0] === "codex") {
          return { stdout: "Logged in using ChatGPT", stderr: "", exitCode: 0 };
        }
        return {
          stdout: [
            JSON.stringify({
              id: 2,
              result: {
                rateLimits: {
                  limitId: "codex", limitName: "Codex", planType: "plus",
                  primary: { usedPercent: 25, resetsAt: 1_800_000_000, windowDurationMins: 300 },
                  secondary: { usedPercent: 10, resetsAt: 1_800_086_400, windowDurationMins: 10_080 }
                }
              }
            }),
            JSON.stringify({ id: 3, result: { summary: { lifetimeTokens: 123_456, peakDailyTokens: 4_000, longestRunningTurnSec: 120, currentStreakDays: 3, longestStreakDays: 7 }, dailyUsageBuckets: [{ startDate: "2026-10-05", tokens: 4_000 }] } })
          ].join("\n"),
          stderr: "",
          exitCode: 0
        };
      },
      removeContainer: async (containerId) => { removed.push(containerId); }
    };
    const gateway = new DockerCodexGateway(defaultConfig(), async () => runtime);

    const result = await gateway.getStatus("account_42");

    assert.match(runInput?.name ?? "", /^authy_status_[a-f0-9]{12}$/);
    assert.equal(runInput?.networkMode, "bridge");
    assert.deepEqual(commands[0]?.command, ["codex", "login", "status"]);
    assert.deepEqual(commands[1]?.command.slice(0, 2), ["sh", "-c"]);
    assert.equal(result.subscription, "active");
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.deepEqual(result.tokenUsage, {
      lifetimeTokens: 123_456,
      peakDailyTokens: 4_000,
      longestRunningTurnSeconds: 120,
      currentStreakDays: 3,
      longestStreakDays: 7,
      daily: [{ startDate: "2026-10-05", tokens: 4_000 }]
    });
    assert.deepEqual(result.rateLimits, [{
      id: "codex",
      name: "Codex",
      plan: "plus",
      primary: { usedPercent: 25, resetsAt: "2027-01-15T08:00:00.000Z", windowDurationMinutes: 300 },
      secondary: { usedPercent: 10, resetsAt: "2027-01-16T08:00:00.000Z", windowDurationMinutes: 10_080 }
    }]);
    assert.deepEqual(removed, ["status-container"]);
  });

  it("reports an account as inactive when Codex says it is not logged in", async () => {
    const runtime: DockerRuntime = {
      createVolume: async () => undefined,
      runEphemeral: async () => ({ containerId: "status-container" }),
      executeCommand: async () => ({ stdout: "Not logged in", stderr: "", exitCode: 1 }),
      removeContainer: async () => undefined
    };
    const gateway = new DockerCodexGateway(defaultConfig(), async () => runtime);

    const result = await gateway.getStatus("account_42");

    assert.equal(result.subscription, "inactive");
  });

  it("filters Codex JSONL events according to every execution detail level", async () => {
    const eventLines = [
      JSON.stringify({ type: "turn.started", thread_id: "thread_1" }),
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", summary: ["Inspecting the project."] } }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", exit_code: 0 } }),
      JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/index.ts", kind: "modified" }] } }),
      JSON.stringify({ type: "item.completed", item: { type: "mcp_call", server_label: "docs", name: "list_resources", output: { content: [{ type: "resource_link", uri: "docs://guide", name: "Guide" }] } } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ type: "output_text", text: "Task completed." }] } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 4 } })
    ];
    const commands: Parameters<DockerRuntime["executeCommand"]>[0][] = [];
    const removed: string[] = [];
    const runtime: DockerRuntime = {
      createVolume: async () => undefined,
      runEphemeral: async () => ({ containerId: "exec-container" }),
      executeCommand: async (input) => {
        commands.push(input);
        input.onStdout?.(`${eventLines[0]}\n${eventLines[1]}\n${eventLines[2]}\n`);
        input.onStdout?.(`${eventLines[3]}\n${eventLines[4]}\n${eventLines[5]}\n${eventLines[6]}\n`);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      removeContainer: async (containerId) => { removed.push(containerId); }
    };
    const gateway = new DockerCodexGateway(defaultConfig(), async () => runtime);
    const run = async (detailLevel: "verbose" | "internal" | "turns" | "end") => {
      const streamed: Array<{ type: string; data: Record<string, unknown> }> = [];
      const result = await gateway.execute({ accountId: "account_42", prompt: "Run tests", detailLevel, timeoutMs: 1_000 }, (value) => streamed.push(value));
      return { result, streamed };
    };

    const verbose = await run("verbose");
    const internal = await run("internal");
    const turns = await run("turns");
    const end = await run("end");

    assert.deepEqual(commands[0]?.command.slice(0, 2), ["sh", "-c"]);
    assert.match(commands[0]?.command[2] ?? "", /--sandbox read-only/);
    assert.equal(commands[0]?.command.at(-2), "1s");
    assert.equal(commands[0]?.command.at(-1), "Run tests");
    assert.equal(verbose.streamed.length, 7);
    assert.deepEqual(verbose.streamed[2], { type: "item.completed.command", data: { command: "npm test", exit_code: 0 } });
    assert.deepEqual(verbose.streamed[3], { type: "item.completed.file_change", data: { changes: [{ path: "src/index.ts", kind: "modified" }] } });
    assert.deepEqual(verbose.streamed[4], {
      type: "item.completed.tool",
      data: {
        server_label: "docs",
        name: "list_resources",
        output: { content: [{ type: "resource_link", uri: "docs://guide", name: "Guide" }] },
        resources: [{ uri: "docs://guide", name: "Guide" }]
      }
    });
    assert.deepEqual(internal, { result: { exitCode: 0, output: "Task completed." }, streamed: [
      { type: "turn.started", data: { thread_id: "thread_1" } },
      { type: "reasoning.summary", data: { text: "Inspecting the project." } },
      { type: "item.completed.command", data: { command: "npm test", exit_code: 0 } },
      { type: "item.completed.file_change", data: { changes: [{ path: "src/index.ts", kind: "modified" }] } },
      { type: "item.completed.tool", data: { server_label: "docs", name: "list_resources", output: { content: [{ type: "resource_link", uri: "docs://guide", name: "Guide" }] }, resources: [{ uri: "docs://guide", name: "Guide" }] } },
      { type: "turn.completed", data: { usage: { input_tokens: 12, output_tokens: 4 } } },
      { type: "final", data: { text: "Task completed." } }
    ] });
    assert.deepEqual(turns, { result: { exitCode: 0, output: "Task completed." }, streamed: [{ type: "turn.started", data: { thread_id: "thread_1" } }, { type: "turn.completed", data: { usage: { input_tokens: 12, output_tokens: 4 } } }, { type: "final", data: { text: "Task completed." } }] });
    assert.deepEqual(end, { result: { exitCode: 0, output: "Task completed." }, streamed: [] });
    assert.deepEqual(removed, ["exec-container", "exec-container", "exec-container", "exec-container"]);
  });
});

describe("Docker workspace access", () => {
  for (const mode of ["none", "write", "read"] as const) {
    it(`enforces ${mode} workspace access and cleans up the container`, async () => {
      let runInput: Parameters<DockerRuntime["runEphemeral"]>[0] | undefined;
      let command: Parameters<DockerRuntime["executeCommand"]>[0] | undefined;
      const volumes: string[] = [];
      const removed: string[] = [];
      const runtime: DockerRuntime = {
        createVolume: async ({ name }) => { volumes.push(name); },
        runEphemeral: async (input) => { runInput = input; return { containerId: "exec" }; },
        executeCommand: async (input) => { command = input; return { stdout: "", stderr: "", exitCode: 0 }; },
        removeContainer: async (id) => { removed.push(id); }
      };
      const workspace = mode === "none" ? undefined : { source: "/host/project with spaces", readOnly: mode === "read" };
      await new DockerCodexGateway(defaultConfig(), async () => runtime).execute({
        accountId: "ada", prompt: "test", detailLevel: "end", timeoutMs: 1_000, workspace
      }, () => undefined);
      assert.deepEqual(volumes, []);
      assert.deepEqual(runInput?.volumes?.filter((mount) => mount.target === "/workspace"), workspace ? [{
        type: "bind", source: workspace.source, target: "/workspace", readOnly: workspace.readOnly
      }] : []);
      assert.equal(command?.workingDirectory, "/workspace");
      assert.equal(command?.user, "authy");
      const script = command?.command[2] ?? "";
      assert.match(script, mode === "write" ? /--sandbox workspace-write/ : /--sandbox read-only/);
      assert.match(script, /--ask-for-approval never/);
      assert.match(script, /cp -- "\$CODEX_HOME\/auth.json"/);
      assert.match(script, /mv -- "\$authy_updated" "\$authy_credentials"; exit "\$authy_status"/);
      for (const flag of ["features.shell_tool=false", "features.unified_exec=false", "features.apply_patch_freeform=false", "features.js_repl=false", "features.multi_agent=false", "tools.view_image=false"]) {
        assert.equal(script.includes(flag), mode === "none");
      }
      assert.deepEqual(removed, ["exec"]);
    });
  }

  it("removes the container after execution fails", async () => {
    const removed: string[] = [];
    const runtime: DockerRuntime = {
      createVolume: async () => undefined,
      runEphemeral: async () => ({ containerId: "failed-exec" }),
      executeCommand: async () => { throw new Error("failed"); },
      removeContainer: async (id) => { removed.push(id); }
    };
    await assert.rejects(new DockerCodexGateway(defaultConfig(), async () => runtime).execute({
      accountId: "ada", prompt: "test", detailLevel: "end", timeoutMs: 1_000,
      workspace: { source: "/host/repo", readOnly: true }
    }, () => undefined));
    assert.deepEqual(removed, ["failed-exec"]);
  });
});
