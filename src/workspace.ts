import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./errors.js";

export interface ClassifiedWorkspace { scheme: string; location: string; url?: URL; }
export interface ResolvedWorkspace { source: string; readOnly: boolean; }

/** Classify before resolution, without filesystem or network access. */
export function classifyWorkspace(location: string): ClassifiedWorkspace {
  if (typeof location !== "string" || !location.trim() || /[\u0000-\u001f]/.test(location)) {
    throw new UsageError("workspace must be a non-empty local directory path or file URL.");
  }
  // A Windows drive letter is not a URL scheme.
  if (/^[a-z]:/i.test(location)) {
    if (!/^[a-z]:[\\/]/i.test(location)) throw new UsageError("Use an absolute Windows workspace path.");
    return { scheme: "file", location };
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(location)) return { scheme: "file", location };
  try {
    const url = new URL(location);
    return { scheme: url.protocol.slice(0, -1), location, url };
  } catch (cause) {
    throw new UsageError("workspace must be a valid URL or local directory path.", { cause });
  }
}

export interface WorkspaceResolver { resolve(workspace: ClassifiedWorkspace): Promise<string>; }

export class FileWorkspaceResolver implements WorkspaceResolver {
  async resolve(workspace: ClassifiedWorkspace): Promise<string> {
    const url = workspace.url;
    if (url && ((url.hostname && url.hostname !== "localhost") || url.search || url.hash || url.username || url.password)) {
      throw new UsageError("Use a local file URL without credentials, query parameters, or fragments.");
    }
    let path: string;
    try { path = url ? fileURLToPath(url) : workspace.location; }
    catch (cause) { throw new UsageError("The workspace file URL is invalid for this host.", { cause }); }
    if (/^(?:\\\\|\/\/)/.test(path)) throw new UsageError("Network workspace paths are not supported. Use a local directory.");
    try {
      const source = await realpath(resolve(path));
      if (!(await stat(source)).isDirectory()) throw new UsageError("workspace must point to a directory, not a file.");
      return source;
    } catch (cause) {
      if (cause instanceof UsageError) throw cause;
      throw new UsageError("The workspace directory does not exist or cannot be accessed. Check its path and permissions.", { cause });
    }
  }
}

/** New schemes can register a resolver without changing Docker execution. */
export class WorkspaceManager {
  constructor(private readonly resolvers: ReadonlyMap<string, WorkspaceResolver> = new Map([
    ["file", new FileWorkspaceResolver()]
  ])) {}

  async resolve(location: string, readOnly = false): Promise<ResolvedWorkspace> {
    const classified = classifyWorkspace(location);
    const resolver = this.resolvers.get(classified.scheme);
    if (!resolver) throw new UsageError("This workspace URL type is not supported. Use a local directory path or file URL.");
    return { source: await resolver.resolve(classified), readOnly };
  }
}

export function validateWorkspaceInput(input: { workspace?: string; readonly?: boolean }): void {
  if (input.workspace !== undefined) classifyWorkspace(input.workspace);
  if (input.readonly !== undefined && typeof input.readonly !== "boolean") throw new UsageError("readonly must be a boolean.");
}
