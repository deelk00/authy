# Authy API

Die HTTP-API führt Anfragen über die [Authy Engine](../architecture.md) aus und
enthält keine eigene Docker- oder Codex-Logik. Sie startet mit:

```text
authy serve [--host 127.0.0.1] [--port 8787]
```

Die API bindet in v1 ausschließlich an Loopback-Adressen und hat keine
Netzwerk-Authentisierung. Alle Routen beginnen mit `/v1`: `POST /login`,
`DELETE /accounts/:accountId`, `GET /accounts`, `GET /accounts/summary`,
`GET /accounts/:accountId/status` und `POST /exec`.

`login` und `exec` liefern Server-Sent Events. Engine-Ereignisse behalten ihren
Namen, `result` enthält das Abschlussresultat und `error` einen sicheren Fehler.
Die übrigen Routen liefern `{ "ok": true, "data": ... }`; Fehler verwenden
`{ "ok": false, "error": { "code", "message" } }`.

`POST /v1/exec` akzeptiert zusätzlich `workspace` (String: lokaler
Verzeichnispfad oder `file://`-URL) und `readonly` (Boolean, Standard `false`):

```json
{"accountId":"ada","prompt":"Prüfe den Code","workspace":"file:///projects/repo","readonly":true}
```

Der Workspace wird auf dem API-Server aufgelöst. Ohne `workspace` sind Dateitools
deaktiviert; andernfalls wird er lesend/schreibend oder bei `readonly: true`
schreibgeschützt eingebunden. Siehe [`authy exec`](../commands/exec.md).
