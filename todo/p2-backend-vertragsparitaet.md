# SDK-, CLI- und API-Ergebnisverträge angleichen

## Ziel
Identische fachliche Optionen, Ergebnisse und geeignete Ereignisse unabhängig vom gewählten Backend anbieten.

## Aktuelle Referenzen
- `src/client.ts`: Direktes Backend delegiert an `AuthyService.getAccountSummary` ohne Auswahlparameter; CLI und API wenden Auswahlparameter an.
- Lokal reproduziert: `accounts.summary({ activeAccountId: true })` liefert direkt `{ count: 7 }`, über API dagegen `{}`.
- `src/storage.ts`: `AccountSummary` verlangt `count`, obwohl ausgewählte Transportantworten es weglassen können.
- `AccountListInput` bietet keine ID-Auswahl, die CLI (`--ids-only`) und HTTP (`idsOnly`) bereits anbieten.
- `AuthyClient.logout` nimmt keinen Event-Callback an, obwohl die Engine `logout.completed` ausgeben kann.
- `docs/backends/sdk.md`: Sagt gleiche Ergebnisse, Fehler und Ereignisse zu.

## Erwartetes Ergebnis
- Auswahloptionen haben in allen geeigneten Backends dieselbe Wirkung und korrekt beschriebene öffentliche Rückgabetypen.
- Geeignete Ereignisse sind konsistent zugänglich; bewusste Ausnahmen sind dokumentiert.
- Gemeinsame Vertragstests prüfen Optionen, Defaults, Resultate und Fehler für alle drei Client-Backends.
