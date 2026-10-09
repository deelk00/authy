# Aktiven Account für Summary bereitstellen

## Ziel
Die vorhandene Abfrage einer aktiven Account-ID mit einer definierten fachlichen Bedeutung hinterlegen.

## Aktuelle Referenzen
- `src/storage.ts`: `AccountSummary.activeAccountId`.
- `src/service.ts`: `getAccountSummary` liefert ausschließlich `count`.
- `src/cli.ts`: `accounts summary --active-account-id`.
- `src/api.ts`, `src/client.ts`: Entsprechende Summary-Auswahl.
- `docs/commands/accounts/summary.md`: Aktive Account-ID wird ausdrücklich noch nicht ermittelt.

## Erwartetes Ergebnis
- Die Auswahl und Lebensdauer des aktiven Accounts sind definiert und über geeignete Backends verfügbar.
- Summary liefert die ID konsistent; kein Account und Logout des aktiven Accounts haben ein dokumentiertes Verhalten.
- Tests prüfen Auswahl, Persistenz soweit vorgesehen und fehlenden aktiven Account.
