# Normalen Browser-Login im Docker-Betrieb vervollständigen

## Ziel
Den ohne `--headless` angebotenen Login vom aufrufenden Host aus zuverlässig abschließen können.

## Aktuelle Referenzen
- `src/docker/codex-gateway.ts`: Normaler Login startet `codex login`; Fortschrittsdaten werden ausschließlich als Device-URL und Einmalcode erkannt.
- `src/docker/docker-service.ts`: `CreateContainerInput` bietet keinen veröffentlichten Callback-Port.
- `src/service.ts`: `LoginProgress` enthält nur `url` und `code` des Device-Flows.
- `docs/commands/login.md`: Ohne Optionen wird der normale Login zugesagt.

## Erwartetes Ergebnis
- Der unterstützte Browser-Flow stellt nutzbare Autorisierungsinformationen und einen erreichbaren Rückkanal bereit; alternativ wird ein ausdrücklich dokumentierter geeigneter Login-Default eingeführt.
- SDK, CLI und API erhalten passende strukturierte Fortschrittsdaten.
- Tests prüfen den vollständigen Ablauf, fehlgeschlagene Rückmeldung und Abbruch ohne interaktive CLI-Eingaben.
