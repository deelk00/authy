import { Command, CommanderError } from "commander";
import { pathToFileURL } from "node:url";
import { defaultConfig, validateConfig } from "./config.js";
import { createAuthyApiServer, DEFAULT_API_HOST, DEFAULT_API_PORT, type AuthyApiServer, type AuthyApiServerOptions } from "./api.js";
import { asAppError, type ExitCode, UsageError } from "./errors.js";
import {
  createAuthyService,
  type AuthyEvent,
  type AuthyService
} from "./service.js";

interface CliOutput {
  write(message: string): boolean;
}

export interface CliIo {
  stdout: CliOutput;
  stderr: CliOutput;
}

export type ApiServerFactory = (service: AuthyService, options: AuthyApiServerOptions) => AuthyApiServer;

const processIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr
};

/**
 * Creates the CLI. Help is rendered as Commander text; operation results and
 * errors use stable JSON objects so they remain usable by applications and
 * readable when invoked directly from a terminal.
 */
export function createProgram(
  io: CliIo = processIo,
  service?: AuthyService,
  apiServerFactory: ApiServerFactory = createAuthyApiServer
): Command {
  const program = new Command()
    .name("authy")
    .description("Manages isolated Codex accounts and their executions.")
    .option("--formatted", "pretty-print JSON output with two-space indentation")
    .configureHelp({ showGlobalOptions: true })
    .showHelpAfterError(false)
    .helpOption("-h, --help", "display help for command");

  program.exitOverride().configureOutput({
    writeOut: (message) => io.stdout.write(message),
    writeErr: () => undefined,
    outputError: () => undefined
  });

  // Initialize only after parsing so configuration errors honor output options.
  const getService = (): AuthyService => service ??= createDefaultService();

  const writeEvent = (event: AuthyEvent): void => {
    writeJson(io.stdout, {
      ok: true,
      event: event.event,
      message: eventMessage(event.event),
      data: event.data
    }, program.opts().formatted === true);
  };

  const writeResult = (data: unknown, message: string): void => {
    writeSuccess(io.stdout, data, message, program.opts().formatted === true);
  };

  program
    .command("login")
    .description("Signs in to a Codex account.")
    .helpOption("-h, --help", "display help for command")
    .option("--headless", "use the device authorization flow without a browser in the container")
    .option("--api-key-env <name>", "read the API key from this environment variable")
    .option("--display-name <name>", "store a non-sensitive display name")
    .action(async (options) => {
      const data = await getService().login(
        {
          headless: options.headless,
          apiKeyEnv: options.apiKeyEnv,
          displayName: options.displayName
        },
        writeEvent
      );
      writeResult(data, "Sign-in completed successfully.");
    });

  program
    .command("logout")
    .description("Signs out an account and removes its stored credentials.")
    .helpOption("-h, --help", "display help for command")
    .requiredOption("--account-id <id>", "ID of the account to sign out")
    .action(async (options) => {
      const data = await getService().logout({ accountId: options.accountId }, writeEvent);
      writeResult(data, "Account signed out successfully.");
    });

  const accounts = program
    .command("accounts")
    .description("Shows stored accounts and their status.")
    .helpOption("-h, --help", "display help for command");

  accounts
    .command("list")
    .description("Lists stored accounts in a stable order.")
    .helpOption("-h, --help", "display help for command")
    .option("--skip <number>", "number of entries to skip", parseInteger)
    .option("--take <number>", "maximum number of entries to return", parseInteger)
    .option("--filter <text>", "filter by account ID or display name")
    .option("--ids-only", "return account IDs only")
    .action(async (options) => {
      const result = await getService().listAccounts({
        skip: options.skip,
        take: options.take,
        filter: options.filter
      });
      const data = options.idsOnly
        ? { ...result, accounts: result.accounts.map((account) => account.accountId) }
        : result;
      writeResult(data, "Accounts loaded successfully.");
    });

  accounts
    .command("summary")
    .description("Shows a summary of stored accounts.")
    .helpOption("-h, --help", "display help for command")
    .option("--count", "return only the account count")
    .option("--active-account-id", "return the active account ID when available")
    .action(async (options) => {
      const summary = await getService().getAccountSummary();
      const data = options.count || options.activeAccountId
        ? {
            ...(options.count ? { count: summary.count } : {}),
            ...(options.activeAccountId ? { activeAccountId: summary.activeAccountId } : {})
          }
        : summary;
      writeResult(data, "Account summary loaded successfully.");
    });

  accounts
    .command("status")
    .description("Fetches an account's subscription status.")
    .helpOption("-h, --help", "display help for command")
    .requiredOption("--account-id <id>", "account ID")
    .action(async (options) => {
      const data = await getService().getAccountStatus(options.accountId);
      writeResult(data, "Account status loaded successfully.");
    });

  program
    .command("exec")
    .description("Runs a Codex task with a stored account.")
    .helpOption("-h, --help", "display help for command")
    .requiredOption("--account-id <id>", "account ID to use")
    .requiredOption("--prompt <text>", "task prompt for Codex")
    .option("--detail-level <level>", "output detail: verbose, internal, turns, or end", "end")
    .option("--timeout-ms <number>", "maximum runtime in milliseconds", parseInteger)
    .option("--workspace <url>", "local directory path or file URL to mount as the workspace")
    .option("--readonly", "allow only read access to the workspace")
    .action(async (options) => {
      const data = await getService().execute(
        {
          accountId: options.accountId,
          prompt: options.prompt,
          detailLevel: options.detailLevel,
          timeoutMs: options.timeoutMs,
          workspace: options.workspace,
          readonly: options.readonly
        },
        writeEvent
      );
      writeResult(data, "Codex task completed successfully.");
    });

  program
    .command("serve")
    .description("Starts the local Authy HTTP API server.")
    .helpOption("-h, --help", "display help for command")
    .option("--host <host>", "loopback address to listen on", DEFAULT_API_HOST)
    .option("--port <number>", "TCP port to listen on", parseInteger, DEFAULT_API_PORT)
    .action(async (options) => {
      const server = apiServerFactory(getService(), { host: options.host, port: options.port });
      const address = await server.listen();
      writeResult(address, "Authy API server started.");
    });

  return program;
}

export async function runCli(
  argv: string[],
  io: CliIo = processIo,
  service?: AuthyService,
  apiServerFactory?: ApiServerFactory
): Promise<ExitCode> {
  let program: Command | undefined;
  try {
    program = createProgram(io, service, apiServerFactory);
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return 0;
    }

    const appError = error instanceof CommanderError
      ? new UsageError(commanderErrorMessage(error), { cause: error })
      : asAppError(error);
    writeJson(io.stderr, {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message
      }
    }, program?.opts().formatted === true);
    return appError.exitCode;
  }
}

function createDefaultService(): AuthyService {
  const defaults = defaultConfig();
  return createAuthyService(validateConfig({
    ...defaults,
    storageDirectory: process.env.AUTHY_STORAGE_DIRECTORY ?? ".authy",
    codexImage: process.env.AUTHY_CODEX_IMAGE ?? defaults.codexImage
  }));
}

function parseInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError("Provide a non-negative integer.");
  }
  return Number(value);
}

function commanderErrorMessage(error: CommanderError): string {
  const missingOption = /required option '([^']+)' not specified/.exec(error.message);
  if (missingOption) {
    return `The required option ${missingOption[1]} is missing.`;
  }

  const unknownOption = /unknown option '([^']+)'/.exec(error.message);
  if (unknownOption) {
    return `The option ${unknownOption[1]} is unknown. Use --help to see available options.`;
  }

  return "The command or options are invalid. Use --help to see available options.";
}

function eventMessage(event: AuthyEvent["event"]): string {
  const messages: Record<string, string> = {
    "login.started": "Sign-in is starting.",
    "login.progress": "Sign-in is in progress.",
    "login.completed": "Sign-in completed.",
    "logout.completed": "Sign-out completed.",
    "exec.started": "Codex task is starting.",
    "exec.completed": "Codex task completed.",
    "exec.turn.started": "Codex turn started.",
    "exec.turn.completed": "Codex turn completed.",
    "exec.reasoning.summary": "Codex provided a reasoning summary.",
    "exec.command.started": "Codex command started.",
    "exec.command.completed": "Codex command completed.",
    "exec.file_change.started": "Codex file change started.",
    "exec.file_change.completed": "Codex file change completed.",
    "exec.tool.started": "Codex tool call started.",
    "exec.tool.completed": "Codex tool call completed.",
    "exec.final": "Codex produced the final answer.",
    "exec.event": "Codex produced an event."
  };
  return messages[event] ?? "Codex produced an event.";
}

function writeSuccess(output: CliOutput, data: unknown, message: string, formatted = false): void {
  writeJson(output, { ok: true, message, data }, formatted);
}

function writeJson(output: CliOutput, value: unknown, formatted = false): void {
  output.write(`${JSON.stringify(value, null, formatted ? 2 : undefined)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
