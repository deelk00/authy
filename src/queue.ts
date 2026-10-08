import { OperationCancelledError } from "./errors.js";
export interface QueueJob<T> { requestId: string; accountId: string; value: T; createdAt: number; }
export interface QueueLease<T> { job: QueueJob<T>; complete(): void; fail(): void; }
export interface ExecutionQueue<T> { enqueue(accountId: string, value: T, signal?: AbortSignal): Promise<QueueLease<T>>; recover(): void; }
export class InMemoryExecutionQueue<T> implements ExecutionQueue<T> {
  private readonly tails = new Map<string, Promise<void>>();
  constructor(private readonly leaseMs = 30_000, private readonly windowMs = 0, private readonly now = () => Date.now()) {}
  async enqueue(accountId: string, value: T, signal?: AbortSignal): Promise<QueueLease<T>> {
    if (signal?.aborted) throw new OperationCancelledError("The operation was cancelled.");
    const requestId = crypto.randomUUID(); let release!: () => void; const done = new Promise<void>((resolve) => { release = resolve; });
    const previous: Promise<void> = this.tails.get(accountId) ?? Promise.resolve(); this.tails.set(accountId, previous.then((): Promise<void> => done));
    await Promise.race([previous, aborted(signal)]); if (this.windowMs > 0) await delay(this.windowMs, signal);
    let settled = false; const timer = setTimeout(() => finish(), this.leaseMs);
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); release(); if (this.tails.get(accountId) === done) this.tails.delete(accountId); } };
    return { job: { requestId, accountId, value, createdAt: this.now() }, complete: finish, fail: finish };
  }
  recover(): void { /* Expiring leases release themselves; no persistent state in this adapter. */ }
}
function aborted(signal?: AbortSignal): Promise<never> { return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new OperationCancelledError("The operation was cancelled.")), { once: true })); }
function delay(ms: number, signal?: AbortSignal): Promise<void> { return Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), aborted(signal)]); }
