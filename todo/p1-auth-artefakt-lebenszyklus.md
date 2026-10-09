# Auth-Artefaktvertrag im Docker-Betrieb umsetzen

## Ziel
Die konfigurierte Freigabe und Größenbegrenzung von Auth-Artefakten auch bei tatsächlichen Docker-Logins einhalten und verwaiste Zugangsdaten vermeiden.

## Aktuelle Referenzen
- `src/config.ts`: `authArtifacts`, `maxArtifactBytes`.
- `src/storage.ts`: `FileArtifactRepository`.
- `src/docker/codex-gateway.ts`: `login` schreibt direkt ins Auth-Volume und liefert eine leere Artefakt-Map zurück.
- `src/service.ts`: `login` kann deshalb nur den lokalen Artefaktbestand prüfen und zurückrollen; Auth-Daten im Docker-Volume bleiben bei Login- oder Metadatenfehlern unberücksichtigt.
- `docs/architecture.md`: Nicht freigegebene Auth-Dateien werden nicht persistiert.

## Erwartetes Ergebnis
- Die Verantwortung für den tatsächlichen Auth-Bestand ist eindeutig; freigegebene Dateinamen und Größenlimits gelten am wirksamen Speicherort.
- Fehlgeschlagene oder abgebrochene Logins hinterlassen keine verwaisten Zugangsdaten.
- Tests prüfen verbotene/übergroße Artefakte und Fehler nach erfolgreicher Anmeldung mit einem Fake-Runtime.
