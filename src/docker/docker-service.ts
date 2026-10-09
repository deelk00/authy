import { DockerClient } from "@docker/node-sdk";
import type {
  ContainerCreateRequest,
  ContainerCreateResponse,
  ExecConfig,
  ExecInspectResponse,
  ExecStartConfig,
  IDResponse,
  Volume,
  VolumeCreateOptions
} from "@docker/node-sdk";
import { PassThrough, type Writable } from "node:stream";
import { platform } from "node:os";
import { AppError, DependencyUnavailableError, OperationCancelledError, UsageError } from "../errors.js";

export interface DockerApi {
  containerCreate(
    spec: ContainerCreateRequest,
    options?: { name?: string; platform?: string }
  ): Promise<ContainerCreateResponse>;
  volumeCreate(spec: VolumeCreateOptions): Promise<Volume>;
  containerExec(containerId: string, config: ExecConfig): Promise<IDResponse>;
  execStart(
    execId: string,
    stdout: Writable,
    stderr: Writable,
    config?: ExecStartConfig
  ): Promise<void>;
  execInspect(execId: string): Promise<ExecInspectResponse>;
  containerStart?(containerId: string): Promise<void>;
  containerDelete?(containerId: string, options?: { force?: boolean; volumes?: boolean; link?: boolean }): Promise<void>;
}

export interface DockerRuntimeConfig { image: string; authVolumeName: string; codexVolumeName: string; networkMode?: string; }
export function authyLabels(requestId: string, accountId: string): Record<string, string> { return { "com.authy.managed": "true", "com.authy.request-id": requestId, "com.authy.account-id": accountId }; }
export function authyMounts(config: DockerRuntimeConfig): CreateContainerInput["volumes"] { return [{ source: config.authVolumeName, target: "/codex-auth", readOnly: true }, { source: config.codexVolumeName, target: "/codex-home", readOnly: false }]; }
export function authyContainerName(action: string, requestId: string): string {
  const normalizedAction = action.toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(normalizedAction)) {
    throw new UsageError("container action must contain only lowercase letters, numbers, or underscores.");
  }
  const hash = requestId.replaceAll("-", "").slice(0, 12);
  if (!/^[a-f0-9]{12}$/.test(hash)) {
    throw new UsageError("requestId must begin with a UUID hash.");
  }
  return `authy_${normalizedAction}_${hash}`;
}

export interface CreateVolumeInput {
  name: string;
  driver?: string;
  labels?: Record<string, string>;
  driverOptions?: Record<string, string>;
}

export interface CreateContainerInput {
  image: string;
  name?: string;
  command?: string[];
  environment?: string[];
  labels?: Record<string, string>;
  volumes?: Array<{ source: string; target: string; readOnly?: boolean; type?: "volume" | "bind" }>;
  networkMode?: string;
}

export interface ExecuteCommandInput {
  containerId: string;
  command: string[];
  environment?: string[];
  workingDirectory?: string;
  user?: string;
  onStdout?: (output: string) => void;
  onStderr?: (output: string) => void;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export class DockerService {
  constructor(private readonly docker: DockerApi) {}

  static async fromDockerConfig(): Promise<DockerService> {
    if (process.env.DOCKER_HOST) {
      return new DockerService(await DockerClient.fromDockerHost(process.env.DOCKER_HOST));
    }

    if (platform() === "win32") {
      // Docker Desktop's current-context pipe is docker_engine. The SDK's
      // config resolver may select the inactive Linux-engine pipe instead.
      return new DockerService(await DockerClient.fromDockerHost("npipe://./pipe/docker_engine"));
    }

    return new DockerService(await DockerClient.fromDockerConfig());
  }

  async createVolume(input: CreateVolumeInput): Promise<Volume> {
    requireValue(input.name, "volume name");
    return this.translate(() => this.docker.volumeCreate({
      Name: input.name,
      Driver: input.driver,
      Labels: input.labels,
      DriverOpts: input.driverOptions
    }));
  }

  async createContainer(input: CreateContainerInput): Promise<ContainerCreateResponse> {
    requireValue(input.image, "container image");
    input.command?.forEach((part) => requireValue(part, "command argument"));

    return this.translate(() => this.docker.containerCreate(
      {
        Image: input.image,
        Cmd: input.command,
        Env: input.environment,
        Labels: input.labels,
        HostConfig: input.volumes
          ? {
              Privileged: false,
              NetworkMode: input.networkMode ?? "none",
              Mounts: input.volumes.map((volume) => ({
                Type: volume.type ?? "volume",
                Source: volume.source,
                Target: volume.target,
                ReadOnly: volume.readOnly ?? false
              }))
            }
          : { Privileged: false, NetworkMode: input.networkMode ?? "none" },
        Hostname: undefined
      },
      { name: input.name }
    ));
  }

  async executeCommand(input: ExecuteCommandInput): Promise<CommandOutput> {
    requireValue(input.containerId, "container ID");
    if (input.command.length === 0) {
      throw new UsageError("command must contain at least one argument");
    }
    input.command.forEach((part) => requireValue(part, "command argument"));

    const exec = await this.translate(() => this.docker.containerExec(input.containerId, {
      Cmd: input.command,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: input.environment,
      WorkingDir: input.workingDirectory,
      User: input.user
    }));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    if (input.onStdout) {
      stdout.on("data", (chunk: Buffer | string) => input.onStdout?.(chunk.toString()));
    }
    if (input.onStderr) {
      stderr.on("data", (chunk: Buffer | string) => input.onStderr?.(chunk.toString()));
    }
    const stdoutText = readStream(stdout);
    const stderrText = readStream(stderr);

    await this.translate(() => this.docker.execStart(exec.Id, stdout, stderr, { Detach: false, Tty: false }));
    stdout.end();
    stderr.end();

    const [stdoutValue, stderrValue, inspection] = await Promise.all([
      stdoutText,
      stderrText,
      this.translate(() => this.docker.execInspect(exec.Id))
    ]);

    return { stdout: stdoutValue, stderr: stderrValue, exitCode: inspection.ExitCode };
  }
  async runEphemeral(input: CreateContainerInput, signal?: AbortSignal): Promise<{ containerId: string }> {
    if (signal?.aborted) throw new OperationCancelledError("The Docker operation was cancelled.");
    const created = await this.createContainer(input);
    try {
      if (!this.docker.containerStart) throw new DependencyUnavailableError("Docker does not support starting containers.");
      await this.translate(() => this.docker.containerStart!(created.Id));
      if (signal?.aborted) throw new OperationCancelledError("The Docker operation was cancelled.");
      return { containerId: created.Id };
    } catch (error) { await this.removeContainer(created.Id); throw error; }
  }
  async removeContainer(containerId: string): Promise<void> { if (!this.docker.containerDelete) return; try { await this.docker.containerDelete(containerId, { force: true, volumes: false }); } catch (error) { if (!(error instanceof AppError)) throw new DependencyUnavailableError("Docker cleanup failed.", { cause: error }); throw error; } }
  private async translate<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (error instanceof AppError) throw error; throw new DependencyUnavailableError("Docker is unavailable.", { cause: error }); } }
}

function requireValue(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new UsageError(`${label} must not be empty`);
  }
}

function readStream(stream: PassThrough): Promise<string> {
  stream.setEncoding("utf8");
  let value = "";
  stream.on("data", (chunk: string) => {
    value += chunk;
  });
  return new Promise((resolve, reject) => {
    stream.once("end", () => resolve(value));
    stream.once("error", reject);
  });
}
