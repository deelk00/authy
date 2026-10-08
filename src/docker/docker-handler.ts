import type {
  CommandOutput,
  CreateContainerInput,
  CreateVolumeInput,
  DockerService,
  ExecuteCommandInput
} from "./docker-service.js";

/** Application boundary for future HTTP, queue, or CLI handlers. */
export class DockerHandler {
  constructor(private readonly dockerService: DockerService) {}

  createVolume(input: CreateVolumeInput) {
    return this.dockerService.createVolume(input);
  }

  createContainer(input: CreateContainerInput) {
    return this.dockerService.createContainer(input);
  }

  executeCommand(input: ExecuteCommandInput): Promise<CommandOutput> {
    return this.dockerService.executeCommand(input);
  }
}
