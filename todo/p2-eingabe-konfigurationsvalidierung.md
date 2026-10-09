# Öffentliche Eingaben und Konfigurationsgrenzen vollständig validieren

## Ziel
Ungültige Eingaben an der gemeinsamen Anwendungsgrenze konsistent ablehnen.

## Aktuelle Referenzen
- `src/service.ts`: Prompt-Prüfung akzeptiert reine Leerzeichen und prüft die Maximallänge erst nach `trim`.
- `src/config.ts`: `validateConfig` akzeptiert `defaultTimeoutMs: 0` und `maxListTake: 0`, obwohl diese Werte später unbrauchbar sind; Digest-Prüfung kontrolliert nur das Vorkommen von `@sha256:`.
- `src/storage.ts`: Standard-`take` ist immer `25`, auch wenn das konfigurierte Maximum kleiner ist. `validRecord` prüft Account-ID, Zeitstempel und optionalen Anzeigenamen nur unvollständig; unpassende JSON-Strukturen werden still als leer behandelt.
- Lokal reproduziert: Leerzeichen-Prompt erreicht den Gateway; beide Nullwerte passieren die Konfigurationsprüfung.

## Erwartetes Ergebnis
- Prompt-, Konfigurations- und gespeicherte Metadatenverträge werden vollständig geprüft; Fehler besitzen sichere, typisierte Meldungen.
- Erlaubte Grenzwerte und Pagination-Defaults passen zusammen, beschädigte gespeicherte Daten werden erkennbar behandelt.
- Tests decken Grenzwerte, fehlerhafte Metadaten und gleiche Fehlersemantik über SDK, CLI und API ab.
