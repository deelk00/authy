# Account-Queue zuverlässig serialisieren

## Ziel
Den dokumentierten Vertrag „höchstens ein laufender Job pro Account“ auch bei langen Aufgaben und Abbrüchen erfüllen.

## Aktuelle Referenzen
- `src/queue.ts`: `InMemoryExecutionQueue.enqueue`, `QueueLease`, `recover`.
- `src/service.ts`: `DefaultAuthyService.execute`, `createAuthyService`.
- `docs/architecture.md`: accountbezogene Serialisierung.
- Der Lease-Timer gibt laufende Jobs unabhängig von deren Ende frei. Ein während des Wartens abgebrochener Job lässt sein `done` ungelöst. Der Vergleich zur Entfernung aus `tails` vergleicht unterschiedliche Promises.
- Lokal reproduziert: Ein zweiter Job erhält nach Lease-Ablauf Zugang, obwohl der erste nicht abgeschlossen ist; nach einem abgebrochenen wartenden Job bleibt der nächste blockiert.
- Jede Service-Instanz besitzt eine eigene Queue; getrennte CLI-Prozesse koordinieren dieselben gespeicherten Accounts nicht.

## Erwartetes Ergebnis
- Laufende Jobs desselben Accounts überlappen nicht; unterschiedliche Accounts bleiben parallel nutzbar.
- Abbruch und Fehler geben wartende Nachfolger frei und entfernen nicht mehr benötigten Queue-Zustand.
- Die unterstützte Koordination zwischen Prozessen ist definiert und umgesetzt oder ihre Begrenzung ausdrücklich dokumentiert.
- Tests decken lange Jobs, abgebrochene Wartepositionen, Fehler und die unterstützte Prozesskoordination ab.
