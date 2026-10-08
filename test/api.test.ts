import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthyApiServer } from "../src/api.js";
import { UsageError } from "../src/errors.js";
import type { AuthyService } from "../src/service.js";

const service: AuthyService = {
  login: async (_input, onEvent) => { onEvent?.({ event: "login.started", data: {} }); return { accountId: "ada" }; },
  logout: async ({ accountId }) => ({ accountId, loggedOut: true }),
  listAccounts: async () => ({ accounts: [{ accountId: "ada", createdAt: "2026-01-01", lastUsedAt: "2026-01-01" }], total: 1, skip: 0, take: 25 }),
  getAccountSummary: async () => ({ count: 1 }),
  getAccountStatus: async (accountId) => ({ accountId, subscription: "active", checkedAt: "2026-01-01T00:00:00.000Z", cached: false, tokenUsage: null, rateLimits: null }),
  execute: async (_input, onEvent) => { onEvent?.({ event: "exec.turn.started", data: { threadId: "thread_1" } }); return { requestId: "request_1", accountId: "ada", exitCode: 0, output: "Done." }; }
};

async function withServer(action: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createAuthyApiServer(service, { port: 0 });
  const address = await server.listen();
  try { await action(`http://${address.host}:${address.port}`); } finally { await server.close(); }
}

describe("Authy HTTP API", () => {
  it("serves account resources and stable JSON errors", async () => withServer(async (baseUrl) => {
    const accounts = await fetch(`${baseUrl}/v1/accounts?idsOnly=true`);
    assert.equal(accounts.status, 200);
    assert.deepEqual(await accounts.json(), { ok: true, data: { accounts: ["ada"], total: 1, skip: 0, take: 25 } });
    const missing = await fetch(`${baseUrl}/v1/missing`);
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { ok: false, error: { code: "INVALID_USAGE", message: "The requested API route or method is invalid." } });
  }));

  it("streams engine events and final results as SSE", async () => withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/exec`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: "ada", prompt: "test" }) });
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const stream = await response.text();
    assert.match(stream, /event: exec\.turn\.started\ndata: {"threadId":"thread_1"}/);
    assert.match(stream, /event: result\ndata: {"requestId":"request_1","accountId":"ada","exitCode":0,"output":"Done\."}/);
  }));

  it("maps login, logout, summary, and status operations", async () => withServer(async (baseUrl) => {
    const login = await fetch(`${baseUrl}/v1/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ headless: true }) });
    assert.match(await login.text(), /event: login\.started[\s\S]*event: result\ndata: {"accountId":"ada"}/);
    const summary = await fetch(`${baseUrl}/v1/accounts/summary?count=true`);
    assert.deepEqual(await summary.json(), { ok: true, data: { count: 1 } });
    const status = await fetch(`${baseUrl}/v1/accounts/ada/status`);
    assert.equal((await status.json() as { data: { subscription: string } }).data.subscription, "active");
    const logout = await fetch(`${baseUrl}/v1/accounts/ada`, { method: "DELETE" });
    assert.deepEqual(await logout.json(), { ok: true, data: { accountId: "ada", loggedOut: true } });
  }));

  it("validates loopback binding and JSON bodies", async () => {
    assert.throws(() => createAuthyApiServer(service, { host: "0.0.0.0" }), UsageError);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/exec`, { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_USAGE");
    });
  });
});
