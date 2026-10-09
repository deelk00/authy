# Authy Engine

Die Authy Engine validiert Eingaben, verwaltet Accounts und Queueing und steuert
Docker- sowie Codex-Prozesse. Sie ist unabhängig von CLI, SDK und HTTP.

## Backends

- [CLI](backends/cli.md)
- [TypeScript-SDK](backends/sdk.md)
- [HTTP-API und Server](backends/api.md)

Neue Engine-Fähigkeiten werden, soweit sinnvoll, in allen Backends angeboten.

## Befehle

| Befehl | Argumente und Optionen | Beschreibung |
| --- | --- | --- |
| [`authy login`](commands/login.md) | `[--headless \| --api-key-env <name>] [--display-name <name>]` | Meldet einen Codex-Account an. |
| [`authy logout`](commands/logout.md) | `--account-id <id>` | Meldet einen Account ab. |
| [`authy accounts list`](commands/accounts/list.md) | `[--skip <n>] [--take <n>] [--filter <text>] [--ids-only]` | Listet gespeicherte Accounts. |
| [`authy accounts summary`](commands/accounts/summary.md) | `[--count] [--active-account-id]` | Liefert Account-Metadaten. |
| [`authy accounts status`](commands/accounts/status.md) | `--account-id <id>` | Fragt den Codex-Status eines Accounts ab. |
| [`authy exec`](commands/exec.md) | `--account-id <id> --prompt <text> [--workspace <url>] [--readonly] [--detail-level <level>] [--timeout-ms <n>]` | Führt einen Codex-Task aus. |
| [`authy serve`](commands/serve.md) | `[--host <loopback-host>] [--port <number>]` | Startet den lokalen HTTP-Server. |

`accounts` ist eine Befehlsgruppe; `list`, `summary` und `status` sind die
ausführbaren Unterbefehle.

## Sicherheits- und Ausführungsmodell

Authy nutzt verwaltete Docker-Volumes für Auth-Daten. Exec-Workspaces werden
explizit über einen Classifier und Resolver ausgewählt und als Bind-Mount
eingebunden; ohne Workspace sind Dateitools deaktiviert. `readonly` schützt den
Mount und setzt die Codex-Sandbox auf Read-only. Exec verwendet ein temporäres
Codex-Home und läuft als `authy`. Account-IDs dürfen keine Pfadbestandteile enthalten.
Container sind unprivilegiert und kurzlebig. Geheimnisse und nicht freigegebene
Auth-Dateien werden weder persistiert noch ausgegeben.

Die Queue ist nach `accountId` partitioniert. Pro Account läuft höchstens ein
Job gleichzeitig; Jobs unterschiedlicher Accounts dürfen parallel laufen.

## Gemeinsame Fehlersemantik

| Kategorie | Bedeutung |
| --- | --- |
| `RUNTIME_ERROR` | Laufzeitfehler |
| `INVALID_USAGE` | Ungültige Eingabe oder Verwendung |
| `INVALID_CONFIGURATION` | Ungültige Konfiguration oder Auth-Daten |
| `DEPENDENCY_UNAVAILABLE` | Docker, Codex oder externer Dienst nicht verfügbar |
| `OPERATION_CANCELLED` | Abbruch oder Zeitlimit |
