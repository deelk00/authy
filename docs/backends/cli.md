# Authy CLI

Die CLI übersetzt Argumente und Ausgabe für die [Authy Engine](../architecture.md).
Erfolge und Ereignisse gehen nach `stdout`, Fehler nach `stderr`; vorgesehen ist
JSON Lines mit genau einem Objekt je Zeile. Die CLI liest nie aus `stdin`.

| Exit-Code | Bedeutung |
| ---: | --- |
| `0` | Erfolg |
| `1` | Laufzeitfehler |
| `2` | Ungültige Verwendung |
| `3` | Konfigurations- oder Anmeldedatenfehler |
| `4` | Externe Abhängigkeit nicht verfügbar |
| `5` | Abbruch oder Zeitlimit |

Die aktuelle Implementierung gibt Hilfe noch als Klartext aus. Erfolgs- und
Fehlerobjekte folgen dagegen dem JSON-Lines-Vertrag und sind für das CLI-SDK-
Backend maschinenlesbar.
