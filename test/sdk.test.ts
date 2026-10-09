import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthyClient, createAuthyApiServer, UsageError, validateAccountId, validateDetailLevel, validateConfig, type AuthyService } from "../src/sdk.js";
describe("SDK contracts", () => {
  it("validates account identifiers without accepting path components", () => { assert.equal(validateAccountId("account_42"), "account_42"); assert.throws(() => validateAccountId("../secret"), UsageError); });
  it("keeps configuration and detail-level inputs explicit", () => { assert.equal(validateDetailLevel("end"), "end"); assert.throws(() => validateDetailLevel("raw"), UsageError); assert.throws(() => validateConfig({ codexImage: "latest" })); });
  it("uses JSON and SSE API contracts through AuthyClient", async () => {
    const service: AuthyService = {
      login: async (_input, onEvent) => { onEvent?.({ event: "login.started", data: {} }); return { accountId: "ada" }; },
      logout: async ({ accountId }) => ({ accountId, loggedOut: true }),
      listAccounts: async () => ({ accounts: [{ accountId: "ada", createdAt: "2026-01-01", lastUsedAt: "2026-01-01" }], total: 1, skip: 0, take: 25 }),
      getAccountSummary: async () => ({ count: 1 }),
      getAccountStatus: async (accountId) => ({ accountId, subscription: "active", checkedAt: "2026-01-01T00:00:00.000Z", cached: false, tokenUsage: null, rateLimits: null }),
      execute: async (input, onEvent) => { assert.equal(input.workspace, "file:///projects/repo"); assert.equal(input.readonly, true); onEvent?.({ event: "exec.turn.started", data: { threadId: "thread_1" } }); return { requestId: "request_1", accountId: "ada", exitCode: 0, output: "Done." }; }
    };
    const server = createAuthyApiServer(service, { port: 0 });
    const address = await server.listen();
    try {
      const client = new AuthyClient({ backend: "api", baseUrl: `http://${address.host}:${address.port}` });
      assert.equal((await client.accounts.list()).total, 1);
      const events: string[] = [];
      assert.deepEqual(await client.execute({ accountId: "ada", prompt: "test", workspace: "file:///projects/repo", readonly: true }, (event) => events.push(event.event)), { requestId: "request_1", accountId: "ada", exitCode: 0, output: "Done." });
      assert.deepEqual(events, ["exec.turn.started"]);
    } finally { await server.close(); }
  });
  it("uses the injected service for the direct backend and defaults to it", async () => {
    const direct: AuthyService = {
      login: async () => ({ accountId: "ada" }), logout: async () => ({ accountId: "ada", loggedOut: true }),
      listAccounts: async () => ({ accounts: [], total: 0, skip: 0, take: 25 }), getAccountSummary: async () => ({ count: 7 }),
      getAccountStatus: async () => ({ accountId: "ada", subscription: "active", checkedAt: "2026-01-01", cached: false, tokenUsage: null, rateLimits: null }),
      execute: async () => ({ requestId: "request", accountId: "ada", exitCode: 0, output: "Done." })
    };
    assert.deepEqual(await new AuthyClient({ service: direct }).accounts.summary(), { count: 7 });
  });
  it("translates CLI JSON Lines into SDK results", async () => {
    const script = "process.stdout.write(JSON.stringify({ok:true,event:'exec.turn.started',data:{threadId:'thread_1'}})+'\\n'+JSON.stringify({ok:true,data:{requestId:'request',accountId:'ada',exitCode:0,output:'Done.'}})+'\\n')";
    const client = new AuthyClient({ backend: "cli", command: process.execPath, args: ["-e", script] });
    const events: string[] = [];
    assert.deepEqual(await client.execute({ accountId: "ada", prompt: "test" }, (event) => events.push(event.event)), { requestId: "request", accountId: "ada", exitCode: 0, output: "Done." });
    assert.deepEqual(events, ["exec.turn.started"]);
  });
  it("preserves workspace arguments across the CLI backend", async () => {
    const script = "process.stdout.write(JSON.stringify({ok:true,data:{requestId:'request',accountId:'ada',exitCode:0,output:JSON.stringify(process.argv.slice(1))}})+'\\n')";
    const client = new AuthyClient({ backend: "cli", command: process.execPath, args: ["-e", script] });
    const workspace = "C:\\Projects\\my repo";
    for (const readonly of [false, true]) {
      const result = await client.execute({ accountId: "ada", prompt: "test", workspace, readonly });
      assert.deepEqual(JSON.parse(result.output), ["exec", "--account-id", "ada", "--prompt", "test", "--workspace", workspace, ...(readonly ? ["--readonly"] : [])]);
    }
  });
});
