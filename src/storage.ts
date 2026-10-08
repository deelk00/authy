import { mkdir, readFile, readdir, rename, rm, stat, writeFile, lstat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { ConfigurationError, UsageError } from "./errors.js";
import { isSafeArtifactName, validateAccountId } from "./config.js";

export interface AccountRecord { accountId: string; displayName?: string; createdAt: string; lastUsedAt: string; }
export interface AccountListInput { skip?: number; take?: number; filter?: string; }
export interface AccountListResult { accounts: AccountRecord[]; total: number; skip: number; take: number; }
export interface AccountSummary { count: number; activeAccountId?: string; }

export interface AccountRepository {
  save(record: AccountRecord): Promise<void>;
  get(accountId: string): Promise<AccountRecord | undefined>;
  list(input: AccountListInput): Promise<AccountListResult>;
  remove(accountId: string): Promise<void>;
}

export class FileAccountRepository implements AccountRepository {
  private readonly file: string;
  constructor(private readonly directory: string, private readonly maxTake = 100) { this.file = join(directory, "accounts.json"); }
  async save(record: AccountRecord): Promise<void> {
    validateAccountId(record.accountId); await mkdir(this.directory, { recursive: true });
    const records = await this.read(); const index = records.findIndex((item) => item.accountId === record.accountId);
    if (index >= 0) records[index] = record; else records.push(record);
    await this.write(records);
  }
  async get(accountId: string): Promise<AccountRecord | undefined> { validateAccountId(accountId); return (await this.read()).find((item) => item.accountId === accountId); }
  async list(input: AccountListInput): Promise<AccountListResult> {
    const skip = input.skip ?? 0, take = input.take ?? 25, filter = (input.filter ?? "").toLocaleLowerCase();
    if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(take) || take < 1 || take > this.maxTake) throw new UsageError(`skip must be non-negative and take must be between 1 and ${this.maxTake}.`);
    const all = (await this.read()).filter((item) => item.accountId.toLowerCase().includes(filter) || item.displayName?.toLowerCase().includes(filter)).sort((a,b) => a.accountId.localeCompare(b.accountId));
    return { accounts: all.slice(skip, skip + take), total: all.length, skip, take };
  }
  async remove(accountId: string): Promise<void> { validateAccountId(accountId); await this.write((await this.read()).filter((item) => item.accountId !== accountId)); }
  private async read(): Promise<AccountRecord[]> { try { const raw: unknown = JSON.parse(await readFile(this.file, "utf8")); return Array.isArray(raw) ? raw.filter(validRecord) : []; } catch (error: any) { if (error?.code === "ENOENT") return []; throw new ConfigurationError("Account metadata could not be read.", { cause: error }); } }
  private async write(records: AccountRecord[]): Promise<void> { await mkdir(this.directory, { recursive: true }); const temp = `${this.file}.tmp`; await writeFile(temp, JSON.stringify(records), { mode: 0o600 }); await rename(temp, this.file); }
}

export class FileArtifactRepository {
  private readonly root: string;
  constructor(directory: string, private readonly allowed: readonly string[], private readonly maxBytes: number) { this.root = resolve(directory, "auth"); }
  async save(accountId: string, artifacts: ReadonlyMap<string, Uint8Array>): Promise<void> {
    const target = this.accountPath(accountId); const temporary = `${target}.tmp`;
    await rm(temporary, { recursive: true, force: true }); await mkdir(temporary, { recursive: true, mode: 0o700 });
    try { for (const [name, bytes] of artifacts) { this.assertAllowed(name); if (bytes.byteLength > this.maxBytes) throw new UsageError("Authentication artifact is too large."); await writeFile(join(temporary, name), bytes, { mode: 0o600 }); } await rm(target, { recursive: true, force: true }); await rename(temporary, target); } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  }
  async list(accountId: string): Promise<string[]> { const path = this.accountPath(accountId); try { const entries = await readdir(path); for (const name of entries) { this.assertAllowed(name); const entry = await lstat(join(path, name)); if (!entry.isFile() || entry.isSymbolicLink() || entry.size > this.maxBytes) throw new ConfigurationError("Stored authentication artifacts are invalid."); } return entries.sort(); } catch (error: any) { if (error?.code === "ENOENT") return []; throw error; } }
  async remove(accountId: string): Promise<void> { await rm(this.accountPath(accountId), { recursive: true, force: true }); }
  private accountPath(accountId: string): string { validateAccountId(accountId); const path = resolve(this.root, accountId); if (relative(this.root, path).startsWith("..")) throw new UsageError("Invalid accountId."); return path; }
  private assertAllowed(name: string): void { if (!isSafeArtifactName(name) || !this.allowed.includes(name)) throw new UsageError("Authentication artifact is not allowed."); }
}
function validRecord(value: unknown): value is AccountRecord { const item = value as AccountRecord; return !!item && typeof item.accountId === "string" && typeof item.createdAt === "string" && typeof item.lastUsedAt === "string"; }
