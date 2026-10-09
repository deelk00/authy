# Entwicklungsleitlinien

## SDK und CLI

- Neue fachliche Fähigkeiten sollen langfristig über alle geeigneten Backends (CLI, SDK und API) verfügbar sein. Ist eine Oberfläche bewusst nicht geeignet, dokumentiere kurz den Grund im Change oder in der Dokumentation.
- SDK und CLI verwenden dieselbe Kernlogik und dieselben fachlichen Verträge. Die CLI übersetzt nur Argumente und Ausgabe; das SDK schreibt nicht selbst auf stdout/stderr.
- Bevorzuge strukturierte SDK-Ergebnisse und wohldefinierte Fehler. Die CLI formatiert diese Ergebnisse für Menschen, ohne die Bedeutung zu verändern.
- Halte Befehle, Optionen, Defaults, Ergebnisse und Fehlersemantik zwischen den Backends konsistent. Wird ein Backend innerhalb eines Auftrags erweitert, ohne die anderen im selben Auftrag anzugleichen, erfasse oder aktualisiere dafür sofort eine Aufgabe in `/todo`; die Abweichung ist nur vorübergehend. Ergänze bei einer Änderung an der gemeinsamen Schnittstelle passende Tests für die betroffenen Backends.

## Offene Aufgaben

- Entdeckte, aber nicht vom aktuellen Auftrag gedeckte Lücken werden in `/todo` als `p<0-3>-<kurzbeschreibung>.md` erfasst oder aktualisiert: `p0` kritisch, `p1` hoch, `p2` normal, `p3` niedrig.
- Eine fachliche Aufgabe hat genau eine Datei. Sie beschreibt Ziel, aktuelle Referenzen (Befehl, Datei, Typ oder Dokumentation) und erwartetes Ergebnis, ohne vergängliche Implementierungsdetails vorwegzunehmen.
- Aktualisiere bestehende Aufgaben bei Änderungen am selben Thema. Nach vollständiger Umsetzung wird die Datei gelöscht.

### CLI-Prozessvertrag

- Erfolgreiche Ergebnisse, maschinenlesbare Ausgaben und normale Statusmeldungen gehen ausschließlich nach `stdout`. Fehler, Warnungen und Diagnoseinformationen gehen ausschließlich nach `stderr`.
- Jede Ausgabe auf `stdout` und `stderr` wird als serialisiertes JSON ausgegeben. Verwende JSON Lines: Jede Ausgabe ist ein vollständiges JSON-Objekt in genau einer Zeile, gefolgt von einem Zeilenumbruch. Schreibe keine unstrukturierten Präfixe, Banner oder Stacktraces in einen der beiden Kanäle.
- Das Erfolgsformat ist `{ "ok": true, "data": ... }`; normale Statusmeldungen dürfen zusätzlich ein stabiles Feld wie `event` enthalten. Das Fehlerformat ist `{ "ok": false, "error": { "code": "…", "message": "…" } }`. `code` ist ein stabiler, maschinenlesbarer Fehlerbezeichner und `message` eine sichere, handlungsorientierte Meldung.
- CLI-Befehle lesen niemals Daten aus `stdin`. Eingaben werden nur als Argumente, Optionen oder über explizit konfigurierte Quellen entgegengenommen. Insbesondere darf kein Fallback auf interaktive Eingaben entstehen.
- Der Prozess beendet sich immer mit einem der folgenden Exit-Codes. Behalte diese Bedeutung stabil, da aufrufende Anwendungen und Skripte darauf vertrauen können:

  | Code | Bedeutung |
  | ---: | --- |
  | `0` | Erfolgreich beendet. |
  | `1` | Fachlicher oder unerwarteter Laufzeitfehler. |
  | `2` | Ungültige Argumente, Optionen oder Befehlsverwendung. |
  | `3` | Fehlende oder ungültige Konfiguration beziehungsweise Anmeldedaten. |
  | `4` | Abhängiger externer Dienst nicht erreichbar oder nicht verfügbar. |
  | `5` | Vorgang abgebrochen oder Zeitlimit erreicht. |

- Jede neue CLI-Fehlerklasse wird einer dieser Kategorien zugeordnet. Ergänze gezielte Tests für Ausgabeziel und Exit-Code, wenn ein Befehl oder sein Fehlerverhalten geändert wird.

### Fehlerbehandlung im CLI

- Erwartbare Fehler werden als projektspezifische, typisierte Exceptions modelliert. Jede Exception trägt mindestens eine sichere, nutzerorientierte Fehlermeldung und einen der definierten Exit-Codes; die ursprüngliche Ursache kann als `cause` erhalten bleiben.
- Fachlogik, SDK und Handler werfen diese Exceptions oder übersetzen Fehler externer Abhängigkeiten in sie. Sie schreiben keine Fehlermeldungen selbst und rufen weder `process.exit()` noch `process.exitCode` auf.
- Der oberste CLI-Einstiegspunkt fängt alle Fehler zentral ab. Er schreibt genau ein JSON-Fehlerobjekt mit der sicheren Fehlermeldung nach `stderr`, setzt den zugehörigen Exit-Code und behandelt unbekannte Fehler als Code `1` ohne technische Interna oder Geheimnisse auszugeben.
- Für Diagnosezwecke dürfen technische Details nur über eine ausdrücklich aktivierte Debug-Ausgabe nach `stderr` erscheinen. Die normale Fehlermeldung bleibt kurz, handlungsorientiert und sicher.
- Teste für jede neue Fehlerklasse mindestens die Zuordnung von Exception zu Exit-Code und die Ausgabe über `stderr`.

## Qualität

- Erweitere öffentliche Typen und Beispiele zusammen mit der Funktionalität. Behalte Eingaben klein, explizit und validiert; valide dort, wo die Anwendung die Verantwortung übernimmt.
- Schreibe Tests für neues Verhalten und wichtige Fehlerpfade. Verwende Mocks oder Fakes für externe Systeme, wenn ein echter Dienst für den Test nicht erforderlich ist.
- Bewahre Rückwärtskompatibilität bei öffentlichen APIs, wenn sie erwartet werden kann. Falls ein Bruch nötig ist, mache ihn sichtbar und dokumentiere eine Migrationsmöglichkeit.
- Halte Abhängigkeiten bewusst: bevorzugt offizielle oder gut gepflegte Pakete, mit nachvollziehbarem Nutzen und ohne unnötige Laufzeitlast.

## Zuverlässigkeit in Produktion

- Gestalte Aufrufe externer Dienste mit klaren Fehlern, konfigurierbaren Grenzen und angemessenem Timeout-/Abbruchverhalten. Wiederhole nur Operationen, bei denen das sicher oder idempotent ist.
- Gib für relevante Operationen genügend Kontext für Diagnose und Monitoring zurück, ohne Zugangsdaten, Tokens oder andere Geheimnisse auszugeben oder zu protokollieren.
- Behandle Ressourcen bewusst: Für angelegte Container, Volumes, Streams und Verbindungen muss klar sein, wer ihre Lebensdauer steuert und wie Fehlerfälle aufgeräumt werden.
- Verzichte auf versteckte globale Konfiguration. Ermögliche explizite Konfiguration und sichere Defaults; begrenze Berechtigungen und Eingaben besonders an Infrastrukturgrenzen wie Docker.

## Abschluss eines Auftrags

- Prüfe vor dem Abschluss, ob die Änderungen Auswirkungen auf die Dokumentation haben, und aktualisiere die betroffenen Stellen. Passe bei Änderungen an Konfiguration oder Persistenz auch `.env.example` an, soweit vorhanden oder erforderlich.
- Führe bei jedem Auftrag vor dem Abschluss `npm run check` aus. Der Befehl prüft ausschließlich die TypeScript-Typen, erzeugt keine Build-Ausgaben und führt keine Tests aus. Er nutzt einen inkrementellen Cache unter `node_modules/.cache/authy/`, um wiederholte Aufrufe ressourcensparend zu halten; externe Typdeklarationen werden dank `skipLibCheck` nicht separat geprüft.
- Führe bei Codeänderungen zusätzlich relevante Tests und den Build aus, soweit die lokale Umgebung dies zulässt. Nicht erreichbare externe Dienste sind kein Grund, Tests ohne Ersatzprüfung zu überspringen.
- Committe nicht, wenn `npm run check` oder eine andere erforderliche Prüfung fehlschlägt. Berichte über Prüfungen, die nicht ausgeführt werden konnten, und nenne den Grund.
- Prüfe mit `git status` die ausstehenden Änderungen. Nimm nur die zum Auftrag gehörenden Änderungen mit `git add` auf; verwende `git add .` nur, wenn alle ausstehenden Änderungen geprüft wurden und zum Auftrag gehören.
- Committe abgeschlossene Änderungen im Format `<type>: <description>`. Zulässige Typen sind `build`, `chore`, `ci`, `docs`, `feature`, `fix`, `perf`, `refactor`, `revert`, `security`, `style` und `test`. Formuliere die Beschreibung kurz und konkret.
