# Account-Nutzungszeit aktuell halten

## Ziel
`lastUsedAt` als verlässliche Nutzungsmetadaten bereitstellen.

## Aktuelle Referenzen
- `src/storage.ts`: `AccountRecord.lastUsedAt`, Rückgabe in Account-Listen.
- `src/service.ts`: `login` setzt den Wert; `execute` aktualisiert ihn auch nach erfolgreicher Nutzung nicht.
- `docs/commands/accounts/list.md`: Rückgabe gespeicherter Account-Metadaten.

## Erwartetes Ergebnis
- Welche Operationen als Nutzung gelten und ob fehlgeschlagene Aufrufe zählen, ist definiert.
- Relevante Operationen aktualisieren den Wert konsistent über alle Backends, ohne andere Metadaten zu verlieren.
- Tests mit kontrollierter Uhr prüfen erfolgreiche und fehlgeschlagene Nutzung.
