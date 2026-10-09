# Gemeinsame Codex-Session-Historie anbinden

## Ziel
Die im Projekteinstieg zugesagte gemeinsame Docker-Session-Historie tatsächlich verwenden.

## Aktuelle Referenzen
- `docs/README.md`: Accounts mit gemeinsamer Docker-Session-Historie.
- `src/config.ts`: `codexVolumeName`.
- `src/docker/docker-service.ts`: `authyMounts` sieht ein gemeinsames `/codex-home` vor.
- `src/docker/codex-gateway.ts`: Login legt das Codex-Volume an, aber keine Gateway-Operation mountet es. Login/Status/Logout verwenden das Account-Verzeichnis im Auth-Volume; Exec verwendet ein temporäres `CODEX_HOME`, kopiert ausschließlich Anmeldedaten und speichert erneuerte Zugangsdaten zurück.

## Erwartetes Ergebnis
- Die vorgesehene gemeinsame Historie wird persistent genutzt und bleibt von Zugangsdaten getrennt.
- Das Verhalten bei Accountwechsel, parallelen Accounts und Logout ist dokumentiert.
- Tests prüfen die tatsächlich verwendeten Mounts und den Erhalt der Historie über kurzlebige Container hinweg.
