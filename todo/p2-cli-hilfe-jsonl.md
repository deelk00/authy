# CLI-Hilfe an den JSON-Lines-Vertrag angleichen

## Ziel
Auch Hilfe und automatisch ausgegebene Bedienhinweise als gültige JSONL-Ergebnisse ausgeben.

## Aktuelle Referenzen
- `AGENTS.md`: Jede Ausgabe auf `stdout` und `stderr` ist ein vollständiges JSON-Objekt pro Zeile.
- `src/cli.ts`: Commander `writeOut` schreibt Hilfe ungefiltert.
- `test/cli.test.ts`: Erwartet ausdrücklich Klartext für `exec --help`.
- `docs/backends/cli.md`: Dokumentiert die derzeitige Abweichung.

## Erwartetes Ergebnis
- Hilfe für Hauptbefehl und Unterbefehle sowie Aufrufe ohne ausführbaren Befehl folgen dem JSONL-Vertrag.
- Erfolgreiche Hilfe verwendet `stdout` und Exit-Code `0`; ungültige Verwendung bleibt auf `stderr` mit Exit-Code `2`.
- Tests und Dokumentation werden an den vereinheitlichten Vertrag angepasst.
