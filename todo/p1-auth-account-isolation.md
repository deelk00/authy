# Zugangsdaten zwischen Accounts isolieren

## Ziel
Accountbezogene Codex-Prozesse nur auf die eigenen Zugangsdaten zugreifen lassen.

## Aktuelle Referenzen
- `docs/README.md`, `docs/architecture.md`: isolierte Accounts und Auth-Daten.
- `src/docker/codex-gateway.ts`: Login-, Logout-, Status- und Exec-Container mounten jeweils das gesamte gemeinsame Auth-Volume unter `/codex-auth` schreibbar.
- `docker/authy-entrypoint.sh`: Alle Accounts werden mit demselben Benutzer `authy` betrieben.
- `CODEX_HOME` wählt lediglich ein Unterverzeichnis; die Mounts begrenzen den Zugriff auf andere Account-Verzeichnisse nicht.

## Erwartetes Ergebnis
- Ein Prozess für Account A kann Zugangsdaten von Account B weder lesen noch verändern.
- Gemeinsam nutzbare Historie ist getrennt von accountbezogenen Geheimnissen organisiert.
- Tests prüfen die wirksamen Zugriffsgrenzen einschließlich schreibbarer Mounts und Logout.
