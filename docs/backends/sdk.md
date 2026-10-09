# Authy SDK

Das SDK stellt `AuthyClient` für die Backends `direct` (Standard), `cli` und
`api` bereit. Alle drei liefern dieselben fachlichen Ergebnisse, Fehler und
Ereignisse.

```ts
import { AuthyClient } from "authy-cli";

const authy = new AuthyClient({
  backend: "api",
  baseUrl: "http://127.0.0.1:8787"
});
const accounts = await authy.accounts.list({ take: 10 });
```

Ohne Konfiguration nutzt der Client `direct` und führt die Engine im aktuellen
Node-Prozess aus. `cli` startet den konfigurierten `authy`-Befehl in einem
separaten Prozess und übersetzt dessen JSON Lines. `api` ruft den HTTP-Server
über `baseUrl` auf. `login` und `execute` liefern Ereignisse über einen
optionalen Event-Callback; das Abschlussresultat wird als Promise zurückgegeben.

`execute` akzeptiert in allen Backends dieselben Workspace-Optionen:

```ts
await authy.execute({
  accountId: "ada",
  prompt: "Prüfe den Code",
  workspace: "file:///C:/Projects/repo",
  readonly: true
});
```

Ohne `workspace` sind Dateitools deaktiviert. Mit `workspace` ist der Zugriff
standardmäßig lesend und schreibend; `readonly: true` schützt den Mount und
aktiviert die Read-only-Sandbox. Die Auflösung findet im Engine-Prozess statt,
bei `api` also auf dem Server. Details und Migration stehen bei
[`authy exec`](../commands/exec.md).
