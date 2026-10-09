import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
import type { Writable } from "node:stream";
import { DockerService, type DockerApi } from "../src/docker/docker-service.js";

class FakeDockerApi implements DockerApi {
  createdContainer?: ContainerCreateRequest;
  createdVolume?: VolumeCreateOptions;
  executed?: ExecConfig;
  deleted: Array<{ containerId: string; force?: boolean; volumes?: boolean }> = [];

  async containerCreate(spec: ContainerCreateRequest): Promise<ContainerCreateResponse> {
    this.createdContainer = spec;
    return { Id: "container-1", Warnings: [] };
  }

  async volumeCreate(spec: VolumeCreateOptions): Promise<Volume> {
    this.createdVolume = spec;
    return {
      Name: spec.Name ?? "generated-volume",
      Driver: spec.Driver ?? "local",
      Mountpoint: "/var/lib/docker/volumes/test/_data",
      Labels: spec.Labels ?? {},
      Scope: "local",
      Options: spec.DriverOpts ?? {}
    };
  }

  async containerExec(_containerId: string, config: ExecConfig): Promise<IDResponse> {
    this.executed = config;
    return { Id: "exec-1" };
  }

  async execStart(
    _execId: string,
    stdout: Writable,
    stderr: Writable,
    _config?: ExecStartConfig
  ): Promise<void> {
    stdout.write("command output");
    stderr.write("command warning");
  }

  async execInspect(_execId: string): Promise<ExecInspectResponse> {
    return { ExitCode: 0 };
  }

  async containerDelete(containerId: string, options?: { force?: boolean; volumes?: boolean }): Promise<void> {
    this.deleted.push({ containerId, force: options?.force, volumes: options?.volumes });
  }
}

describe("DockerService", () => {
  it("maps bind mounts and read-only access without changing named volume defaults", async () => {
    const api = new FakeDockerApi();
    await new DockerService(api).createContainer({ image: "test", volumes: [
      { source: "authy-auth", target: "/auth" },
      { type: "bind", source: "C:\\Projects\\my repo", target: "/workspace", readOnly: true }
    ] });
    assert.deepEqual(api.createdContainer?.HostConfig?.Mounts, [
      { Type: "volume", Source: "authy-auth", Target: "/auth", ReadOnly: false },
      { Type: "bind", Source: "C:\\Projects\\my repo", Target: "/workspace", ReadOnly: true }
    ]);
  });
  it("maps volume and container requests to the Docker SDK", async () => {
    const api = new FakeDockerApi();
    const service = new DockerService(api);

    await service.createVolume({ name: "app-data", labels: { app: "authy" } });
    await service.createContainer({
      image: "alpine:3.21",
      name: "worker",
      command: ["sleep", "infinity"],
      volumes: [{ source: "app-data", target: "/data", readOnly: true }]
    });

    assert.equal(api.createdVolume?.Name, "app-data");
    assert.equal(api.createdContainer?.Image, "alpine:3.21");
    assert.deepEqual(api.createdContainer?.HostConfig?.Mounts, [
      { Type: "volume", Source: "app-data", Target: "/data", ReadOnly: true }
    ]);
  });

  it("captures stdout, stderr, and exit code from an exec command", async () => {
    const api = new FakeDockerApi();
    const output = await new DockerService(api).executeCommand({
      containerId: "container-1",
      command: ["echo", "hello"]
    });

    assert.deepEqual(output, {
      stdout: "command output",
      stderr: "command warning",
      exitCode: 0
    });
    assert.deepEqual(api.executed?.Cmd, ["echo", "hello"]);
    assert.equal(api.executed?.Tty, false);
  });

  it("force-removes completed temporary containers without deleting named volumes", async () => {
    const api = new FakeDockerApi();
    await new DockerService(api).removeContainer("container-1");

    assert.deepEqual(api.deleted, [{ containerId: "container-1", force: true, volumes: false }]);
  });
});
