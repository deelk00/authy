# HTTP-Server mit aktiven Operationen geordnet beenden

## Ziel
Server-Lebensdauer und Shutdown auch bei laufenden Streams und wiederholter Nutzung kontrollieren.

## Aktuelle Referenzen
- `src/api.ts`: `createAuthyApiServer.listen/close`.
- `listen` registriert Prozess-Signalhandler; `close` entfernt sie nicht.
- Signalhandler schließen den Listener ohne Begrenzung, ohne Verwaltung aktiver Operationen und ohne Behandlung einer abgelehnten Close-Promise.
- `docs/commands/serve.md`: Zusage, bei `SIGINT`/`SIGTERM` den Listener zu schließen.

## Erwartetes Ergebnis
- Shutdown besitzt ein definiertes Verhalten für aktive Anfragen und Streams mit angemessener Frist und Ressourcenbereinigung.
- Explizites Schließen entfernt zugehörige Handler; wiederholtes Starten/Schließen hinterlässt keinen globalen Zustand.
- Shutdown-Fehler und Prozessabbruch erfüllen den CLI-JSONL- und Exit-Code-Vertrag.
- Tests prüfen Shutdown während laufender Operationen, wiederholtes Schließen und Freigabe von Listenern.
