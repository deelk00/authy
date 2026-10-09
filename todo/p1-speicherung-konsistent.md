# Account-Speicherung gegen konkurrierende Änderungen absichern

## Ziel
Metadaten und Auth-Artefakte bei parallelen Änderungen und Speicherfehlern konsistent erhalten.

## Aktuelle Referenzen
- `src/storage.ts`: `FileAccountRepository.save/remove/write`, `FileArtifactRepository.save`.
- Metadaten verwenden ungeschützte Read-Modify-Write-Aufrufe und denselben temporären Dateinamen. Artefaktspeicherung verwendet ebenfalls einen festen temporären Pfad und löscht den bisherigen Bestand vor erfolgreichem Austausch.
- `src/service.ts`: `login` entfernt bei einem Metadatenfehler die gespeicherten Artefakte; `logout` führt mehrere nicht gemeinsam abgesicherte Änderungen aus.
- CLI-Prozesse und der HTTP-Server können dasselbe Speicherverzeichnis verwenden.

## Erwartetes Ergebnis
- Parallele Änderungen verlieren keine Accounts und beschädigen keine temporären Dateien oder vorhandenen Artefakte.
- Fehlgeschlagene Updates bewahren den vorherigen gültigen Zustand; teilweise ausgeführte Login-/Logout-Vorgänge sind nachvollziehbar und wiederherstellbar.
- Repository-Tests prüfen konkurrierendes Speichern/Löschen und Fehler beim Schreiben beziehungsweise Austausch.
