# Gemeinsame Engine-Konfiguration über CLI und Server zugänglich machen

## Ziel
Die geeigneten betrieblichen Einstellungen unabhängig vom Einstiegspunkt explizit konfigurieren können.

## Aktuelle Referenzen
- `src/config.ts`: `AuthyConfig` enthält Volumes, Netzwerk, Zeitlimits, Queue-/Cache-Einstellungen und Speichergrenzen.
- `src/client.ts`: Direktes SDK akzeptiert `Partial<AuthyConfig>`.
- `src/cli.ts`: `createDefaultService` übernimmt nur `AUTHY_STORAGE_DIRECTORY` und `AUTHY_CODEX_IMAGE`; `serve` verwendet dieselbe eingeschränkte Konfiguration.
- `docs/backends/cli.md`, `docs/commands/serve.md`: Keine vollständige Konfigurationsbeschreibung.

## Erwartetes Ergebnis
- Geeignete Einstellungen sind beim CLI- und Serverstart über eine dokumentierte explizite Quelle verfügbar.
- Defaults, Validierung und Priorität der Konfigurationsquellen sind backendübergreifend konsistent.
- Nicht pro HTTP-Anfrage konfigurierbare Infrastruktur bleibt ausdrücklich Serverkonfiguration.
- Tests prüfen Übernahme und sichere Konfigurationsfehler mit Exit-Code `3`.
