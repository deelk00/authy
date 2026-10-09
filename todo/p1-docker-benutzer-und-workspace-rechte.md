# Docker-Benutzer und Workspace-Rechte durchgehend festlegen

## Ziel
Login-, Status- und Logout-Prozesse ebenfalls explizit als vorgesehenen unprivilegierten Benutzer ausführen. Die Benutzer- und Dateirechte der expliziten Exec-Workspaces mit einem echten Container prüfen.

## Aktuelle Referenzen
- `src/docker/codex-gateway.ts`: `execute` verwendet explizit `user: "authy"`, ein temporäres Codex-Home und optional einen Bind-Mount unter `/workspace`. Ohne Workspace werden Dateitools deaktiviert; `readonly` schützt Mount und Sandbox.
- `Dockerfile`: Benutzer `authy` mit UID/GID `10002`, Arbeitsverzeichnis `/workspace`.
- `docker/authy-entrypoint.sh`: Bereitet `CODEX_HOME` für `authy` vor. Host-Workspace-Rechte werden bewusst nicht geändert und müssen Zugriff für UID/GID `10002` erlauben.
- Der Entrypoint wechselt nur für den Container-Hauptprozess zu `authy`. `Dockerfile` setzt keinen expliziten `USER`; spätere Docker-Exec-Aufrufe durchlaufen den Entrypoint nicht.
- `src/docker/docker-service.ts`: `ExecuteCommandInput.user` wird unterstützt und bei Exec gesetzt. Login, Status und Logout hängen weiter vom Image-Default ab.
- `test/codex-gateway.test.ts`: Fake-Runtime prüft Exec-Benutzer, Mounts, Sandbox und deaktivierte Dateitools; tatsächliche Dateirechte und das Verhalten der Codex-Version im Image benötigen eine Containerprüfung.

## Erwartetes Ergebnis
- Login, Status, Logout und Exec laufen nachweislich unter dem vorgesehenen Benutzer; es gibt keinen stillen Rückfall auf den Image-Default.
- Der unprivilegierte Benutzer kann in einem explizit schreibbaren Workspace Dateien anlegen und ändern; Read-only-Workspaces bleiben unverändert und Aufrufe ohne Workspace können keine Dateitools nutzen.
- Host-Dateirechte werden nicht automatisch geändert. Frühere automatische Workspace-Volumes werden nicht gelöscht oder eingebunden.
- Ein gezielter Container-/Dateirechtetest oder eine gleichwertige lokale Ersatzprüfung belegt das Verhalten.
