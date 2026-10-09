# Abbruch und Zeitlimits durchgehend unterstützen

## Ziel
Externe Aufrufe und laufende Operationen zuverlässig begrenzen und abbrechen können.

## Aktuelle Referenzen
- `src/docker/docker-service.ts`: `ExecuteCommandInput`, `executeCommand`, `runEphemeral`.
- `src/docker/codex-gateway.ts`: `login`, `logout`, `execute`, `getStatus`, `readAccountUsage`.
- `src/service.ts`: `execute`, `getAccountStatus`.
- `src/cli.ts`: Operationen erhalten kein Signal für Prozessabbruch.
- `src/api.ts`: `stream` beobachtet nur `request.aborted`; Status und Logout erhalten kein Request-Signal.
- Signale erreichen den Containerstart, aber nicht den laufenden Docker-Exec. Nur der Codex-Exec besitzt ein internes Timeout; Queue-Wartezeit und Docker-Aufrufe sind davon nicht begrenzt.

## Erwartetes Ergebnis
- Konfigurierbare Grenzen und Signale wirken auf Wartezeit, Docker-Aufrufe und laufende Codex-Prozesse; die Bedeutung von `timeoutMs` ist dokumentiert.
- CLI-Signale und HTTP-Verbindungsabbrüche beenden die zugehörige Operation und räumen Ressourcen auf.
- Abbruch bleibt auch bei Cache-Treffern konsistent. CLI meldet JSONL auf `stderr` mit Exit-Code `5`.
- Fakes prüfen Abbruch vor und während Ausführung sowie Zeitüberschreitungen ohne echten Docker-Dienst.
