# Ausführungen durchgehend korrelieren und Lebenszyklusereignisse liefern

## Ziel
Ausführungsergebnisse, Queue-Jobs, Ereignisse und Docker-Ressourcen eindeutig derselben Operation zuordnen.

## Aktuelle Referenzen
- `src/queue.ts`: Erzeugt `QueueJob.requestId`.
- `src/service.ts`: Nutzt die Queue-ID für Ergebnisse und Events, übergibt sie aber nicht an `CodexGateway.execute`.
- `src/docker/codex-gateway.ts`: Erzeugt eine zweite unabhängige ID für Containername und Labels.
- `src/service.ts`: `AuthyEventName` bietet `exec.started` und `exec.completed`; der tatsächliche Service emittiert beide nicht.
- `src/cli.ts`: Enthält bereits Meldungen für diese Lebenszyklusereignisse.

## Erwartetes Ergebnis
- Eine stabile Operationskennung verbindet Ergebnis, Ereignisse und Docker-Labels.
- Die angebotenen Lebenszyklusereignisse haben definierte Zeitpunkte und werden konsistent emittiert; Fehler-/Abbruchverhalten ist dokumentiert.
- Tests prüfen Korrelation und Ereignisreihenfolge für erfolgreiche und fehlgeschlagene Aufgaben über geeignete Backends.
