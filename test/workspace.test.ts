import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { classifyWorkspace, WorkspaceManager, validateWorkspaceInput } from "../src/workspace.js";
import { UsageError } from "../src/errors.js";
import { createAuthyService, type CodexGateway, type ExecuteInput } from "../src/service.js";
import { defaultConfig } from "../src/config.js";
import type { ExecutionQueue } from "../src/queue.js";
import { runCli } from "../src/cli.js";

describe("workspace classification and resolution", () => {
  it("classifies paths, Windows drive letters, file URLs, and remote URL schemes", () => {
    for (const location of ["./project", "/projects/my repo", "C:\\Projects\\my repo", "C:/Projects/repo", "file:///tmp/project"]) {
      assert.equal(classifyWorkspace(location).scheme, "file");
    }
    assert.equal(classifyWorkspace("https://example.com/repo").scheme, "https");
    assert.equal(classifyWorkspace("git+ssh://example.com/repo").scheme, "git+ssh");
    for (const location of ["", " ", "C:relative", "file://%invalid", "path\u0000suffix"]) {
      assert.throws(() => classifyWorkspace(location), UsageError);
    }
    assert.throws(() => validateWorkspaceInput({ readonly: "true" as unknown as boolean }), UsageError);
  });

  it("selects the resolver matching the classified scheme", async () => {
    let selected: string | undefined;
    const manager = new WorkspaceManager(new Map([["example", {
      resolve: async (workspace) => { selected = workspace.scheme; return "/resolved/workspace"; }
    }]]));
    assert.deepEqual(await manager.resolve("example://workspace", true), { source: "/resolved/workspace", readOnly: true });
    assert.equal(selected, "example");
    await assert.rejects(new WorkspaceManager().resolve("https://example.com/repo"), UsageError);
  });

  it("resolves existing directories via paths and encoded file URLs, and rejects files and missing paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authy workspace-"));
    try {
      const manager = new WorkspaceManager();
      const source = await realpath(directory);
      assert.deepEqual(await manager.resolve(directory), { source, readOnly: false });
      assert.deepEqual(await manager.resolve(pathToFileURL(directory).href, true), { source, readOnly: true });
      assert.deepEqual(await manager.resolve("."), { source: await realpath("."), readOnly: false });
      await writeFile(join(directory, "file.txt"), "data");
      await assert.rejects(manager.resolve(join(directory, "file.txt")), UsageError);
      await assert.rejects(manager.resolve(join(directory, "missing")), UsageError);
      for (const location of ["file://remote/share", "file:///tmp/repo?x=1", "file:///tmp/repo#fragment", "file:///tmp/%2Fescape", "\\\\server\\share"]) {
        await assert.rejects(manager.resolve(location), UsageError);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("passes resolved access modes to the gateway and rejects invalid workspaces before queueing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authy-workspace-service-"));
    try {
      const executions: Parameters<CodexGateway["execute"]>[0][] = [];
      let enqueued = 0;
      const queue: ExecutionQueue<ExecuteInput> = {
        enqueue: async (accountId, value) => {
          enqueued++;
          return { job: { requestId: "request", accountId, value, createdAt: 0 }, complete: () => undefined, fail: () => undefined };
        },
        recover: () => undefined
      };
      const codex: CodexGateway = {
        login: async () => ({ accountId: "ada", artifacts: new Map() }),
        logout: async () => undefined,
        getStatus: async () => ({ subscription: "unknown", checkedAt: "now", tokenUsage: null, rateLimits: null }),
        execute: async (input) => { executions.push(input); return { exitCode: 0, output: "Done." }; }
      };
      const service = createAuthyService(defaultConfig(), {
        codex, queue,
        accounts: {
          get: async () => ({ accountId: "ada", createdAt: "now", lastUsedAt: "now" }),
          save: async () => undefined, remove: async () => undefined,
          list: async () => ({ accounts: [], skip: 0, take: 25, total: 0 })
        }
      });
      for (const input of [{}, { readonly: true }, { workspace: directory }, { workspace: pathToFileURL(directory).href, readonly: true }]) {
        await service.execute({ accountId: "ada", prompt: "test", ...input });
      }
      assert.deepEqual(executions.map((input) => input.workspace), [undefined, undefined,
        { source: await realpath(directory), readOnly: false }, { source: await realpath(directory), readOnly: true }]);
      for (const workspace of ["", "https://example.com/repo", join(directory, "missing")]) {
        await assert.rejects(service.execute({ accountId: "ada", prompt: "test", workspace }), UsageError);
      }
      assert.equal(enqueued, 4);
      assert.equal(executions.length, 4);
      const stdout: string[] = [], stderr: string[] = [];
      assert.equal(await runCli(["exec", "--account-id", "ada", "--prompt", "test", "--workspace", "https://example.com/repo"], {
        stdout: { write: (value) => (stdout.push(value), true) },
        stderr: { write: (value) => (stderr.push(value), true) }
      }, service), 2);
      assert.deepEqual(stdout, []);
      assert.equal(stderr.length, 1);
      assert.equal(JSON.parse(stderr[0]).error.code, "INVALID_USAGE");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
