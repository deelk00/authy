# Client- und Docker-Streams robust verarbeiten

## Ziel
Fehlerhafte, abgebrochene und große Transportausgaben mit definierten Fehlern und begrenztem Ressourcenverbrauch behandeln.

## Aktuelle Referenzen
- `src/client.ts`: `ApiBackend.stream`, `jsonResponse`, `CliBackend.run`.
- API-Stream-Lese- und Parsefehler passieren die Fehlerübersetzung in `fetch` nicht; JSON-Hüllen und Ergebnisdaten werden weitgehend nur per Type-Cast übernommen.
- CLI-Ausgabe decodiert jeden Buffer einzeln als UTF-8; das kann Zeichen an Chunk-Grenzen beschädigen.
- `src/docker/docker-service.ts`: `readStream` sammelt die komplette Ausgabe; fehlschlagendes `execStart` beendet angelegte Streams nicht im Fehlerpfad.
- CLI-/SSE-Puffer und Docker-Ausgaben haben keine konfigurierbaren Größenlimits; HTTP-Eventausgabe berücksichtigt keinen Rückstau.

## Erwartetes Ergebnis
- Chunk-Grenzen und UTF-8 bleiben korrekt; unvollständige oder ungültige Protokolldaten sowie Verbindungsabbrüche werden typisiert gemeldet.
- Konfigurierbare Grenzen und ein definiertes Verhalten bei Rückstau verhindern unkontrolliertes Wachstum.
- Streams, Leser und Listener werden in Erfolgs-, Fehler- und Abbruchpfaden geschlossen.
- Tests verwenden fragmentierte Unicode-Ausgaben, ungültige Antworten und während des Lesens abbrechende Fake-Streams.
