import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConfigurationError,
  DependencyUnavailableError,
  OperationCancelledError,
  RuntimeError,
  UsageError
} from "../src/errors.js";

describe("application errors", () => {
  it("assigns stable codes and process exit codes", () => {
    assert.deepEqual(
      [
        new RuntimeError(),
        new UsageError("Invalid option"),
        new ConfigurationError("Missing configuration"),
        new DependencyUnavailableError("Docker is unavailable"),
        new OperationCancelledError("Timed out")
      ].map((error) => [error.code, error.exitCode]),
      [
        ["RUNTIME_ERROR", 1],
        ["INVALID_USAGE", 2],
        ["INVALID_CONFIGURATION", 3],
        ["DEPENDENCY_UNAVAILABLE", 4],
        ["OPERATION_CANCELLED", 5]
      ]
    );
  });
});
