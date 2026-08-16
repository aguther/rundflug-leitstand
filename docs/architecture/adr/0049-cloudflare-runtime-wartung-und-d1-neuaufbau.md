# ADR-0049: Cloudflare-Runtime-Wartung und abgesicherter D1-Neuaufbau

## Status

Angenommen am 15. August 2026.

## Kontext

Wrangler, workerd, Worker-Typen, Compatibility-Date und generierte Bindings entwickeln sich als
zusammenhängender Laufzeitstand weiter. Ein gewöhnlicher Build darf trotzdem nicht allein durch
Zeitablauf fehlschlagen. Gleichzeitig erfordert die inkompatible V1.12-D1-Baseline einmalig einen
vollständigen Neuaufbau des ausdrücklich freigegebenen Cloudflare-Ziels. Ein ungesicherter manueller
`d1 delete`-Aufruf könnte dabei den falschen Account oder eine abweichende Ressource treffen.

## Entscheidung

- Wrangler bleibt exakt gepinnt; seine workerd-Version, die Worker-Typen, der Worker-Testpool und die
  generierten Bindings werden gemeinsam verifiziert.
- Die Compatibility-Date entspricht dem getesteten Implementierungsmonat. Nur der monatliche und
  manuell startbare Maintenance-Workflow erzwingt ein Höchstalter von 45 Tagen.
- Persistierte Invocation Logs und Traces sind explizit aktiviert und gesampelt. Laufzeitfehler
  protokollieren lediglich eine sichere Fehlerklasse, niemals freie Fehlermeldungen mit PINs, Tokens,
  Telefonnummern, Push-Endpunkten oder öffentlichen Ticketcodes.
- Der Remote-D1-Neuaufbau ist ausschließlich über `cloudflare:recreate-d1` zulässig. Das CLI ist ohne
  Bestätigung read-only, prüft Anmeldung, Account, Zielmanifest, D1-ID, R2 und EU-Jurisdiktion und
  verlangt anschließend eine aus dem D1-Namen abgeleitete exakte Löschbestätigung.
- Nach dem Löschen wird D1 unter demselben Namen und mit EU-Jurisdiktion neu erzeugt. Manifest und
  generierte Konfiguration erhalten die neue ID; ausschließlich `0001_v1_12_baseline.sql` wird
  angewandt. Das CLI deployt nicht und spielt keine Seed-Daten ein.

## Konsequenzen

- Ein veralteter Runtime-Stand wird planbar sichtbar, ohne normale Builds nach 45 Tagen zufällig zu
  destabilisieren.
- Der Neuaufbau bewahrt Worker-Name, URL, R2-Name und Secrets, verwirft aber die alte D1-ID und alle
  darin enthaltenen Nutzdaten.
- Das Zielmanifest unter `.wrangler/targets` bleibt zwingende lokale Sicherheitsgrenze und wird nicht
  eingecheckt. Konto- und Ressourcen-IDs dürfen ausgegeben werden; Secret-Werte und Nutzdaten nie.
- Nach einem Fehler zwischen Löschen und Migration wird der Lauf mit dem aktualisierten Zielmanifest
  fortgesetzt: neue D1-Jurisdiktion prüfen, Baseline anwenden, danach erst deployen. Die gelöschte
  Entwicklungs-/Abnahme-D1 wird nicht wiederhergestellt; falls fachlich nötig, erfolgt Restore in
  eine isolierte Datenbank nach `docs/operations/backup-restore.md`.

## Alternativen

- Ein automatisches monatliches Deployment wurde verworfen, weil Compatibility-Verhalten bewusst
  geprüft und nicht allein wegen eines Kalenderdatums geändert werden soll.
- Ein direktes Skript mit fest kodierter Account- oder D1-ID wurde verworfen, weil Zielmanifeste nach
  jedem Neuaufbau eine neue ID tragen und mehrere Cloudflare-Accounts erreichbar sein können.
