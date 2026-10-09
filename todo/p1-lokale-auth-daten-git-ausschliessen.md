# Lokale Account- und Auth-Daten vom Repository ausschließen

## Ziel
Verhindern, dass der standardmäßig im Projekt angelegte lokale Authy-Bestand versehentlich versioniert wird.

## Aktuelle Referenzen
- `src/config.ts`, `src/cli.ts`: Standardspeicherverzeichnis `.authy`.
- `src/storage.ts`: `accounts.json` und freigegebene Auth-Artefakte unter dem Speicherverzeichnis.
- `.gitignore`: Enthält keinen Ausschluss für `.authy/`.
- `.dockerignore`: Schließt `.authy` bereits aus dem Docker-Build-Kontext aus.

## Erwartetes Ergebnis
- Der Standardbestand wird von Git ignoriert.
- Dokumentation erklärt den Umgang mit abweichenden Speicherverzeichnissen und bereits versionierten Daten.
- Eine Prüfung mit Git bestätigt den Ausschluss, ohne reale Geheimnisse anzulegen.
