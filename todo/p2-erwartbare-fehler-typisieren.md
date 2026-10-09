# Erwartbare Infrastrukturfehler vollständig typisieren

## Ziel
Bekannte Speicher-, Server- und Codex-Fehler den bestehenden stabilen Fehlerkategorien zuordnen.

## Aktuelle Referenzen
- `src/errors.ts`: Typisierte Fehlerklassen und `asAppError`.
- `src/storage.ts`: Mehrere Schreib-, Lösch- und Artefaktlesefehler werden als rohe Dateisystemfehler weitergegeben.
- `src/api.ts`: Listenerfehler werden unverändert verworfen beziehungsweise weitergereicht; der CLI-Fallback ordnet sie pauschal Laufzeitfehlern zu.
- `src/docker/codex-gateway.ts`: Nicht erfolgreiche Codex-Aufrufe werden weitgehend unabhängig von ihrer Ursache `RuntimeError`.
- `test/errors.test.ts`: Prüft Klassenzuordnung, aber nicht die CLI-`stderr`-Ausgabe für jede vorhandene Klasse.

## Erwartetes Ergebnis
- Erwartbare Fehler erhalten sichere, handlungsorientierte Meldungen und eine bewusst gewählte bestehende Kategorie; Ursachen bleiben intern erhalten.
- SDK und Handler schreiben keine eigenen Fehlerausgaben; die CLI gibt zentral genau einen JSONL-Fehler aus.
- Tests prüfen insbesondere Konfiguration/Anmeldedaten (`3`), nicht verfügbare Abhängigkeiten (`4`), Abbruch (`5`) und unbekannte Fehler (`1`) einschließlich Ausgabeziel.
