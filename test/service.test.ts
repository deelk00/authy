import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import type { ExecutionQueue } from "../src/queue.js";
import {
  DefaultAuthyService,
  type CodexGateway,
  type ExecuteInput
} from "../src/service.js";
import type { AccountRepository, FileArtifactRepository } from "../src/storage.js";

describe("DefaultAuthyService execution events", () => {
  it("maps structured Codex output to stable, typed SDK events", async () => {
    const accounts: AccountRepository = {
      save: async () => undefined,
      get: async () => ({ accountId: "account_42", createdAt: "2026-01-01", lastUsedAt: "2026-01-01" }),
      list: async () => ({ accounts: [], total: 0, skip: 0, take: 25 }),
      remove: async () => undefined
    };
    const queue: ExecutionQueue<ExecuteInput> = {
      enqueue: async (accountId, value) => ({
        job: { requestId: "request_1", accountId, value, createdAt: 0 },
        complete: () => undefined,
        fail: () => undefined
      }),
      recover: () => undefined
    };
    const codex: CodexGateway = {
      login: async () => ({ accountId: "account_42", artifacts: new Map() }),
      logout: async () => undefined,
      getStatus: async () => ({ subscription: "unknown", checkedAt: "2026-01-01", tokenUsage: null, rateLimits: null }),
      execute: async (_input, onOutput) => {
        onOutput({ type: "turn.started", data: { threadId: "thread_1" } });
        onOutput({ type: "item.completed.tool", data: { name: "list_resources" } });
        onOutput({ type: "unrecognised.event", data: { value: true } });
        return { exitCode: 0, output: "Done." };
      }
    };
    const service = new DefaultAuthyService({
      config: defaultConfig(),
      accounts,
      artifacts: {} as FileArtifactRepository,
      queue,
      codex
    });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    await service.execute({ accountId: "account_42", prompt: "List resources", detailLevel: "verbose" }, (event) => events.push(event));

    assert.deepEqual(events, [
      { event: "exec.turn.started", data: { requestId: "request_1", accountId: "account_42", threadId: "thread_1" } },
      { event: "exec.tool.completed", data: { requestId: "request_1", accountId: "account_42", name: "list_resources" } },
      { event: "exec.event", data: { requestId: "request_1", accountId: "account_42", value: true, sourceType: "unrecognised.event" } }
    ]);
  });
});
