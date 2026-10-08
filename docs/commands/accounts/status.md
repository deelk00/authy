# `authy accounts status`

## Funktion und Bedienung

Fragt Codex-Anmeldestatus sowie optionale Nutzungs- und Rate-Limit-Daten eines
gespeicherten Accounts ab.

```text
authy accounts status --account-id <id>
```

| Option | Wirkung |
| --- | --- |
| `--account-id <id>` | Erforderliche, validierte ID des zu prüfenden Accounts. |

Die Antwort enthält `subscription`, `checkedAt`, `cached` sowie optionale
Token- und Rate-Limit-Daten. Optionale Werte können `null` sein.

## Interner Ablauf

Die Engine prüft den Account und verwendet zunächst ihren Status-Cache. Bei
einem Cache-Miss startet der Gateway einen temporären Container mit Netzwerk,
führt `codex login status` aus und fragt danach optionale Nutzungsdaten ab. Das
Ergebnis wird gecacht und der Container entfernt.

```mermaid
flowchart TD
  A[Account-ID validieren] --> B{Account vorhanden?}
  B -->|nein| C[Konfigurationsfehler]
  B -->|ja| D{Gültiger Cache?}
  D -->|ja| E[Cache-Ergebnis ausgeben]
  D -->|nein| F[Status-Container mit Netzwerk starten]
  F --> G[codex login status ausführen]
  G --> H[Optionale Nutzungsdaten abfragen]
  H --> I[Ergebnis cachen]
  I --> J[Container entfernen]
  J --> K[Status ausgeben]
```
