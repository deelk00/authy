# Authy CLI

Die CLI übersetzt Argumente und Ausgabe für die [Authy Engine](../architecture.md).
Erfolge und Ereignisse gehen nach `stdout`, Fehler nach `stderr`; vorgesehen ist
standardmäßig kompaktes JSON Lines mit genau einem Objekt je Zeile. Die CLI liest
nie aus `stdin`.

Die globale Option `--formatted` formatiert alle JSON-Ausgaben mit zwei
Leerzeichen Einrückung, auch Ereignisse und Fehler auf `stderr`. Sie kann vor,
zwischen oder nach den Befehlen stehen, zum Beispiel:

```sh
authy accounts list --formatted
authy --formatted accounts summary
authy exec --account-id ada --prompt "Prüfe das Projekt" --formatted
```

Mit `--formatted` umfasst jedes JSON-Objekt mehrere Zeilen; diese explizite
Ausnahme vom JSON-Lines-Vertrag dient der lesbaren Konsolenausgabe. Ohne die
Option wird JSON immer kompakt ausgegeben, auch im Terminal. Für Skripte und
das CLI-SDK-Backend muss die Option entfallen, damit JSON Lines erhalten bleibt.
Das SDK liefert strukturierte Ergebnisse und die API verwendet ihren eigenen
HTTP-Vertrag; die reine Konsolenoption wird dort nicht angeboten.

| Exit-Code | Bedeutung |
| ---: | --- |
| `0` | Erfolg |
| `1` | Laufzeitfehler |
| `2` | Ungültige Verwendung |
| `3` | Konfigurations- oder Anmeldedatenfehler |
| `4` | Externe Abhängigkeit nicht verfügbar |
| `5` | Abbruch oder Zeitlimit |

Die aktuelle Implementierung gibt Hilfe noch als Klartext aus. Erfolgs- und
Fehlerobjekte folgen ohne `--formatted` dem JSON-Lines-Vertrag und sind für das
CLI-SDK-Backend maschinenlesbar.
