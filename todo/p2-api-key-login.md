# API-Key-Login im Docker-Gateway implementieren

## Ziel
Die bereits angebotene Anmeldung über eine explizite Umgebungsvariable tatsächlich nutzbar machen.

## Aktuelle Referenzen
- `src/cli.ts`: `login --api-key-env`.
- `src/service.ts`: `LoginInput.apiKeyEnv`, Auflösung des Schlüssels.
- `src/client.ts`, `src/api.ts`: Login über CLI- und API-Backend.
- `src/docker/codex-gateway.ts`: `login` lehnt jeden `apiKey` ausdrücklich mit `RuntimeError` ab.
- `docs/commands/login.md`: Dokumentierte Implementierungslücke.

## Erwartetes Ergebnis
- CLI, direktes SDK und HTTP-API unterstützen denselben fachlichen Login-Vertrag.
- Der Schlüssel erscheint weder in Ausgaben noch in Fehlermeldungen; die Quelle der Umgebungsvariable beim API-Backend ist dokumentiert.
- Tests prüfen erfolgreichen Login, fehlende/ungültige Anmeldedaten und sichere Fehlerausgabe mit passenden Exit-Codes.
