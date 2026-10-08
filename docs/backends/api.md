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
