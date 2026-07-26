# ADR-0027: Portable Cloudflare-Ziele und sichere Reset-Fortsetzung

## Status

Angenommen – Release 1.10.0

## Entscheidung

Cloudflare-Umgebungen werden aus einem Zielnamen mit lokaler, nicht versionierter
Wrangler-Konfiguration reproduzierbar aufgebaut. D1 und R2 liegen in EU-Jurisdiktion; vorhandene
Ressourcen werden nie automatisch ersetzt, geleert oder gelöscht. Acceptance-Ressourcen behalten
ihre Namen. Produktion ist ein getrenntes Ziel mit zusätzlicher Bestätigung und manuellem Gate.

Ein Werksreset verlangt immer eine gültige Administrationssitzung, Gerätebindung und die aktuelle
Konto-PIN. Der idempotente Reset-Beleg bindet die 30 Minuten gültige Setup-Fortsetzung an den
ursprünglichen Browser. Der Grant liegt nur gehasht in D1 und wird als `Secure`, `HttpOnly`,
`SameSite=Strict` und hostgebundenes Cookie übertragen und beim Setup atomar verbraucht.

Für den Verlust von Browser und Grant existiert ausschließlich der beim Neuaufbau erzeugte starke
Installations-Notfallcode. Er liegt als Worker-Secret und im betreiberseitigen Passwortsafe,
funktioniert nur bei leerer Installation und wird serverseitig rate-limitiert.

## Folgen

- ADR-0007 bleibt als Historie der ersten Acceptance-Umgebung erhalten; seine Beschränkung auf
  genau ein Ziel ist für 1.10.0 durch diese Entscheidung abgelöst.
- Dashboard-Schritte und manuell eingetragene D1-IDs gehören nicht zum Normalaufbau.
- Domain-Cutover und Backup-Import bleiben getrennte, freigabepflichtige Verfahren.
- Ohne gültigen Browsergrant oder Notfallcode ist eine leere Installation absichtlich nicht
  einrichtbar; letzter Break-Glass-Weg ist die bewusste Secret-Rotation im Cloudflare-Account.
