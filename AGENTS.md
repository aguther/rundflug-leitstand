# Rundflug-Leitstand – Arbeitsanweisung für Codex und Entwickler

## Mission

Implementiere die Ausbaustufe V1 des Rundflug-Leitstands gemäß Release
`docs/requirements/requirements-v1.12.0.md`. Das System ist kein einfaches Ticketing, sondern koordiniert
Verkauf, Ressourcengruppen-Queues, Flight-Line-Ereignisse, Prognosen, öffentliche Statusanzeigen und
Auditierung.

## Quellen der Wahrheit

1. `docs/requirements/requirements-v1.12.0.md`
2. `docs/requirements/requirements-v1.12.0.yaml`
3. der unveränderte Basiskatalog V1.4 und die in V1.12.0 konsolidierten fortgeltenden Anforderungen
4. freigegebene ADRs in `docs/architecture/adr/`
5. automatisierte Tests
6. diese `AGENTS.md`

Binäre PDF-/DOCX-Dateien dienen als unveränderte Referenz. Ändere keine Anforderung stillschweigend.
Dokumentiere Unklarheiten in `docs/requirements/open-questions.md`.

Die zentrale, aus diesen Quellen abgeleitete Architekturdokumentation liegt unter
`docs/architecture/arc42/`.
Sie beschreibt den aktuellen Architekturstand, ersetzt aber weder Anforderungen noch ADRs oder Tests.

## Nicht verhandelbare fachliche Invarianten

- Ein Produkt verwendet genau eine Ressourcengruppe.
- Ein Flugzeug darf zu einem Zeitpunkt höchstens einer aktiven Ressourcengruppe angehören.
- Jede Ressourcengruppe besitzt genau eine operative Queue.
- Eine Fluggruppen-/Slotnummer ist eine stabile Kommunikationskennung, keine garantierte Uhrzeit und
  keine dauerhafte Flugzeugbindung.
- Die konkrete Flugzeugzuordnung bleibt bis zur operativen Bestätigung flexibel.
- Ein Ticket darf höchstens einem nicht abgeschlossenen Umlauf zugeordnet sein.
- Gruppen werden niemals automatisch getrennt. Eine beim Verkauf sichtbar ausgewiesene Aufteilung
  entsteht nur durch die bewusste Verkaufsaktion; die Buchungsgruppe bleibt dabei verbunden.
- Nach `NEXT` beziehungsweise Aufruf erfolgt keine automatische Umbesetzung. Das System darf nur einen
  Vorschlag zur menschlichen Bestätigung machen.
- Ist-Ereignisse treiben die Prognose. Planzeit, Prognosezeit und Ist-Zeit bleiben getrennt.
- `GELANDET` bedeutet nicht automatisch `VERFÜGBAR`. Ein Abschluss-/Verfügbarkeitsereignis schließt den
  Turnaround.
- Jede operative Zustandsänderung erzeugt einen append-only Audit-Eintrag.
- Schreibkommandos sind idempotent und prüfen eine erwartete Version.
- Veraltete konkurrierende Schreibversuche werden abgelehnt und niemals still überschrieben.
- Im Kernsystem werden keine Gastnamen gespeichert.
- Öffentliche Nutzer sehen Zeitfenster oder Wartepositionen, keine garantierten Uhrzeiten.
- Hinweise zu Gewicht, Kraftstoff oder Zuladung besitzen niemals Freigabesemantik.
- Die Anwendung trifft keine flugbetriebliche, sicherheitsrelevante oder luftrechtliche Entscheidung.

## Architektur

- TypeScript durchgängig.
- React/Vite-PWA in `apps/web`.
- Cloudflare Worker in `apps/worker`.
- D1 als relationale Source of Truth.
- SQLite-basiertes Durable Object je Veranstaltung für serialisierte Kommandos und WebSockets.
- R2 für portable Sicherungen, Veranstaltungslogos und Analysepakete.
- Reine Fachlogik gehört in `packages/domain` und darf keine Cloudflare-, HTTP-, UI- oder
  Datenbankabhängigkeit besitzen.
- Transportverträge gehören in `packages/contracts`.
- UI-Komponenten führen keine fachlichen Zustandsübergänge selbst aus.
- Worker-Routen duplizieren keine Domänenregeln.
- Bestätigte Änderungen, Event Ledger, Idempotenzbeleg und Outbox werden atomar beziehungsweise in
  einer fachlich konsistenten D1-Batch-/Transaktionsgrenze gespeichert.
- Realtime-Veröffentlichung erfolgt erst nach erfolgreicher Persistenz.
- Cloudflare-spezifische Implementierung bleibt in Adaptern außerhalb des Domain-Pakets.

### Pflege der arc42-Dokumentation

- Änderungen an Systemgrenzen, Bausteinen, öffentlichen oder internen Schnittstellen, Persistenz,
  Laufzeitinteraktionen, Deployment, Querschnittskonzepten, Qualitätszielen, Risiken oder ADRs müssen
  im selben Auftrag in den betroffenen Kapiteln und Mermaid-Diagrammen unter
  `docs/architecture/arc42/`
  nachvollzogen werden.
- Strukturprägende Entscheidungen werden zuerst als ADR dokumentiert und in Kapitel 9 der
  arc42-Dokumentation als aktueller Entscheidungsstand verlinkt und zusammengefasst.
- Ist eine Änderung nach Prüfung nicht architekturrelevant, wird dies in der Pull-Request-Checkliste
  ausdrücklich bestätigt.
- Nach einer arc42-Änderung sind mindestens `npm run docs:arc42:check` und `npm run docs:verify`
  auszuführen; Änderungen am PDF-Werkzeug oder an Diagrammen erfordern zusätzlich
  `npm run docs:arc42:pdf` und eine visuelle Prüfung des erzeugten Dokuments.

## Erforderliche Befehle

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run requirements:verify
npm run check
```

## Arbeitsmethode

- Beginne mehrstufige Aufgaben mit einem aktualisierten Ausführungsplan.
- Bearbeite pro Branch genau ein fachlich zusammenhängendes Ergebnis.
- Referenziere Anforderungs-IDs in Issues, Tests und Pull Requests.
- Ändere die binären Anforderungsquellen nicht im Rahmen von Feature-Arbeit.
- Führe keine neue Abhängigkeit ohne dokumentierten Zweck ein.
- Verwende ausschließlich synthetische Daten in Entwicklung und Tests.
- Logge niemals Telefonnummern, Ticket-Tokens, Administrator-PINs oder Secrets.
- Datenbankmigrationen benötigen eine Rollback- oder Wiederherstellungsnotiz.
- Schwäche keine Invariante ab, nur damit ein Test besteht.
- Für UI-Arbeit zunächst vollständige Konzepte für die betroffene Oberfläche erzeugen und freigeben,
  danach implementieren und im Browser gegen das Konzept prüfen.
- Beim UI-Finish besitzen pixelgenaue Ordnung und Layoutkonstanz hohe Priorität: zusammengehörige
  Buttons, Felder, Beschriftungen, Icons und Statusanzeigen folgen gemeinsamen Fluchten, einheitlichen
  Controlhöhen und konsistenten Abständen.
- Lade-, Pending-, Filter-, Status- und Inhaltsänderungen dürfen keine vermeidbaren Layoutsprünge
  verursachen. Aktionsgruppen, Spalten, Kopfpositionen und Primäraktionen bleiben größen- und
  positionsstabil; der Gesamtscreen scrollt möglichst nicht und umfangreiche Listen erhalten genau
  einen klar begrenzten Scrollbereich.
- In Dateneingabeformularen folgen Tab-Sequenzen den veränderbaren Form-Controls und notwendigen
  Aktionen. Rein informative Hilfe-, Tooltip- und Dekorationselemente dürfen keine zusätzlichen
  Tabstopps erzeugen.
- Diese UI-Finish-Kriterien werden in den relevanten Light-/Dark-Viewports visuell gegen das
  freigegebene Konzept geprüft; reine Layoutkorrekturen benötigen nur ein dem Risiko angemessenes
  Mindestmaß gezielter Regressionstests.
- Kein generisches Karten-Dashboard anstelle der vorgeschriebenen Ein-Bildschirm-Abläufe für Kasse und
  Flight Line.

## Sprache und Benennung

Die Sprache fachlicher und technischer Artefakte wird bewusst getrennt.

### Fachliche Artefakte

Die folgenden Inhalte dürfen auf Deutsch oder in einer für den jeweiligen Auftrag geeigneten anderen
Sprache verfasst sein:

- Requirements und Anforderungskataloge,
- fachliche Beschreibungen,
- User Stories und Akzeptanzkriterien,
- ADRs und Architekturbegründungen,
- Betriebs- und Benutzerdokumentation,
- Issues und Planungsdokumente,
- sichtbare Texte der Anwendung,
- FIDS-, Ticket-, Push- und Hinweistexte.

Bestehende deutsche Fachbegriffe müssen nicht künstlich übersetzt werden. Fachliche Dokumentation soll
in der Sprache konsistent bleiben, in der das jeweilige Dokument geführt wird.

### Technische Implementierung

Alle neu erstellten oder geänderten technischen Bezeichner müssen Englisch verwenden. Dies gilt
insbesondere für:

- Variablen,
- Konstanten,
- Funktionen und Methoden,
- Klassen, Interfaces, Types und Enums,
- Properties und Felder,
- Dateinamen und Verzeichnisnamen,
- API-Routen und API-Properties,
- Events, Commands und Queries,
- Datenbanktabellen, Spalten, Indizes, Constraints und Views,
- Migrationen und technische Seed-Daten,
- Konfigurationsschlüssel und Umgebungsvariablen,
- technische Status- und Fehlercodes,
- Testnamen, Fixture-Bezeichner und Mock-Bezeichner.

Technische Kommentare, JSDoc/TSDoc, entwicklerorientierte Fehlermeldungen, interne Logmeldungen und
Diagnoseausgaben müssen Englisch verwenden.

Nutzerseitige Texte dürfen weiterhin Deutsch sein. Die Trennung zwischen internem technischem Schlüssel
und angezeigtem Text ist beizubehalten, beispielsweise:

```ts
const messageKey = "groupRecall.active";
const displayText = "Bitte begeben Sie sich zur Flight Line.";
```

Keine neuen deutschen oder gemischtsprachigen technischen Bezeichner einführen.

Wird bestehender Code mit deutschen technischen Bezeichnern wesentlich geändert, soll geprüft werden,
ob die betroffenen Bezeichner innerhalb des Auftrags sicher auf Englisch migriert werden können. Eine
großflächige Umbenennung außerhalb des Auftragsumfangs ist zu vermeiden.

Persistierte oder öffentlich verwendete Bezeichner dürfen nicht allein aus stilistischen Gründen
inkompatibel umbenannt werden. Dazu gehören insbesondere:

- bereits ausgerollte Datenbankspalten,
- bestehende API-Verträge,
- Event-Typen,
- externe Konfigurationsschlüssel,
- gespeicherte JSON-Strukturen,
- öffentliche URLs.

Notwendige Umbenennungen benötigen eine kompatible Migration beziehungsweise eine ausdrücklich
dokumentierte Breaking Change.

## Git- und Commit-Workflow

### Grundsatz

`main` ist der stabile Integrationsbranch. Parallele Agenten arbeiten nicht gleichzeitig direkt auf
`main`.

Jeder unabhängige Auftrag wird auf einem eigenen kurzlebigen Branch und in einem ausschließlich diesem
Auftrag zugewiesenen Git-Worktree bearbeitet. Der für einen Auftrag verantwortliche Agent ist nach
erfolgreicher Validierung grundsätzlich auch für die Integration seines Branches nach `main`
verantwortlich.

Direkte Implementierungscommits auf `main` sind nicht zulässig. Ausnahmen müssen vom Auftraggeber
ausdrücklich benannt sein, beispielsweise eine abgesicherte Historienbereinigung oder eine rein
administrative Repository-Operation.

### Beginn eines Auftrags

Vor Beginn der Implementierung muss der Auftrag einen eigenen Worktree mit einem eigenen Branch auf
Basis des aktuellen `origin/main` besitzen.

Stellt die Ausführungsumgebung bereits einen eindeutig diesem Auftrag zugewiesenen Worktree bereit,
wird dieser verwendet. In einem bestehenden Worktree wird niemals ein weiterer verschachtelter
Worktree angelegt.

Andernfalls erstellt der koordinierende Agent selbst einen Worktree unter dem verbindlichen
Codex-Worktree-Root.

Der Codex-Home-Pfad wird in dieser Reihenfolge bestimmt:

1. der Wert der Umgebungsvariable `CODEX_HOME`, sofern sie gesetzt ist,
2. unter Windows `%USERPROFILE%\.codex`,
3. unter POSIX-Systemen `$HOME/.codex`.

Der verbindliche Pfad für agentenerzeugte Worktrees dieses Repositorys lautet:

```text
<codex-home>/worktrees/agent-created/rundflug-leitstand/<branch-slug>
```

Für `<branch-slug>` werden Schrägstriche im vollständigen Branch-Namen durch Bindestriche ersetzt.
Beispiel:

```text
Branch:   feat/active-group-recall
Worktree: C:\Users\Andreas\.codex\worktrees\agent-created\rundflug-leitstand\feat-active-group-recall
```

Andere Ablageorte sind nicht zulässig. Insbesondere werden Worktrees nicht:

- im primären Repository unter `.worktrees`,
- in einem anderen Unterverzeichnis des primären Repositorys,
- als frei gewähltes Geschwisterverzeichnis neben dem Repository,
- oder in einem temporären Verzeichnis

angelegt.

Vor der Erstellung werden Repository, aktueller Zustand, registrierte Worktrees, Basisrevision und
der vollständig aufgelöste absolute Zielpfad geprüft:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git fetch origin
git worktree list --porcelain
```

Der Agent prüft, dass der aufgelöste Zielpfad innerhalb von
`<codex-home>/worktrees/agent-created/rundflug-leitstand` liegt. Kann der Codex-Home-Pfad nicht
eindeutig bestimmt oder der vorgesehene Zielpfad nicht sicher verwendet werden, hält der Agent vor
der ersten Änderung an und meldet den konkreten Grund.

Anschließend legt der koordinierende Agent den Worktree aus einem bestehenden Repository-Checkout an:

```bash
git fetch origin
git worktree add -b <type>/<short-task-name> <absolute-worktree-path> origin/main
```

Der Agent prüft im neu angelegten Worktree vor der ersten Änderung:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
```

Branch-Namen müssen Englisch, kleingeschrieben und in Kebab-Case formuliert sein.

Beispiele:

```text
feat/active-group-recall
feat/flight-line-layout
feat/ticket-search-filter
feat/push-delivery-diagnostics
fix/flight-line-behavior
```

Ein Branch enthält genau ein fachlich zusammenhängendes Ergebnis.

### Parallele Agenten

Jeder Agent arbeitet während der Implementierung ausschließlich auf seinem zugewiesenen Branch und in
seinem zugewiesenen Worktree. Ein eigener Branch ohne eigenen Worktree ist für parallele schreibende
Arbeit nicht ausreichend.

Zwei schreibende Agenten dürfen niemals dasselbe Working Directory verwenden. Ein Branch darf nicht
gleichzeitig in mehreren Worktrees ausgecheckt werden. Der Agent führt in seinem Arbeits-Worktree kein
`git switch main` aus.

Agenten dürfen Änderungen anderer Agenten oder des Auftraggebers nicht:

- verwerfen,
- zurücksetzen,
- überschreiben,
- stillschweigend in den eigenen Commit aufnehmen,
- durch pauschale Konfliktauflösung ersetzen.

Dev-Server-Ports, lokale D1-/Wrangler-Zustände, temporäre Verzeichnisse, Build-Ausgaben und externe
Testressourcen müssen pro Auftrag getrennt sein. Repository-weite Git-Wartungsoperationen wie `git gc`,
`git prune` oder das Löschen fremder Branches und Worktrees sind während paralleler Arbeit unzulässig.

Vor Änderungen an gemeinsam genutzten Integrationspunkten ist der aktuelle Stand von `origin/main`
erneut abzurufen. Dies gilt insbesondere für:

- Datenbankmigrationen,
- Schemas und Verträge,
- Lockfiles,
- zentrale Exporte,
- gemeinsam genutzte Domain Types,
- Routing-Konfiguration,
- generierte Artefakte.

Neue Commits auf `origin/main` werden nicht ungeprüft während einer unvollständigen Änderung in den
Arbeitsbranch übernommen. Die verpflichtende vollständige Synchronisierung erfolgt spätestens vor der
abschließenden Validierung und erneut, falls eine konkurrierende Integration den Push nach `main`
verhindert.

### Sicherung des Arbeitsbranches

Der Arbeitsbranch darf und soll bei längeren Aufgaben während der Bearbeitung regelmäßig auf `origin`
gesichert werden:

```bash
git push -u origin HEAD
```

Wurde ein bereits veröffentlichter Arbeitsbranch nach einem Rebase neu geschrieben, ist ausschließlich
folgender Push zulässig:

```bash
git push --force-with-lease origin HEAD
```

Ein unbedingter Force-Push ist verboten. `main` darf niemals force-gepusht werden, außer im Rahmen einer
ausdrücklich beauftragten und abgesicherten einmaligen Historienbereinigung.

Zwischenstände auf dem Arbeitsbranch müssen als solche erkennbar bleiben und dürfen nicht als fertig
oder integriert gemeldet werden.

### Commits

Änderungen sind in kleinen, logisch abgeschlossenen Einheiten zu committen.

Ein Commit soll:

- genau einen nachvollziehbaren Zweck besitzen,
- keine unabhängigen Änderungen vermischen,
- nach Möglichkeit buildbar und testbar sein,
- die zugehörigen Tests und erforderlichen Migrationen enthalten,
- keine zufälligen Formatierungsänderungen in unbeteiligten Dateien enthalten.

Commits werden nicht künstlich nach Dateityp getrennt. Implementierung, zugehörige Tests und zwingend
erforderliche Dokumentationsänderungen dürfen gemeinsam committed werden, wenn sie eine atomare Einheit
bilden.

Vor jedem Commit sind mindestens auszuführen:

```bash
git status --short
git diff
git diff --staged
```

Nur zum Commit gehörende Dateien oder Hunks dürfen gestaged werden.

### Commit-Format

Alle Commit-Nachrichten müssen Englisch verwenden und dem Conventional-Commits-Format entsprechen:

```text
<type>(<optional-scope>): <imperative summary>
```

Zulässige Standardtypen:

```text
feat
fix
refactor
test
docs
perf
build
ci
chore
style
revert
```

Der Scope ist optional und beschreibt einen stabilen technischen oder fachlichen Bereich.

Bevorzugte Scopes sind beispielsweise:

```text
admin
boarding
cashier
contracts
database
domain
fids
flight-line
forecast
notifications
push
simulator
ticket
web
worker
```

Beispiele:

```text
feat(flight-line): add active group recall
fix(push): handle expired subscriptions
refactor(domain): extract turnaround calculation
test(boarding): cover recalled group transitions
docs(requirements): clarify recall cancellation
chore(database): normalize migration naming
```

Regeln für die Betreffzeile:

- Englisch verwenden.
- Imperativ beziehungsweise handlungsorientierte Grundform verwenden.
- Mit einem Kleinbuchstaben beginnen.
- Kein Punkt am Ende.
- Möglichst höchstens 72 Zeichen.
- Beschreiben, was der Commit bewirkt, nicht welche Dateien geändert wurden.
- Keine Versionsnummer in den Betreff aufnehmen, sofern die Änderung nicht ausschließlich die
  Versionierung betrifft.
- Keine Anforderungs-IDs in den Betreff aufnehmen.

Ein Commit-Body ist zu ergänzen, wenn Motivation, Randbedingungen oder nicht offensichtliche
Auswirkungen erklärt werden müssen.

Format:

```text
feat(flight-line): add active group recall

Persist the recall state separately from the regular queue status so that
FIDS, ticket status, and push notifications can present a consistent
operational message.

Refs: F-FLN-120, F-PUB-080
```

Anforderungs-IDs stehen im Commit-Body in einer separaten `Refs:`-Zeile. Sie dürfen alternativ oder
zusätzlich in Tests, Issues und Pull Requests referenziert werden.

Automatisch erzeugte Co-Author-Trailer sind zulässig. Alle selbst formulierten Commit-Inhalte bleiben
Englisch.

### Synchronisierung vor Abschluss

Unmittelbar vor der abschließenden Validierung muss der Agent seinen Arbeitsbranch auf den neuesten Stand
von `origin/main` bringen:

```bash
git fetch origin
git rebase origin/main
```

Konflikte müssen semantisch gelöst werden. Es ist nicht zulässig, Konflikte pauschal mit `ours` oder
`theirs` aufzulösen, ohne beide Änderungen zu prüfen.

Ein bereits erfolgreicher Prüflauf darf für die abschließende Integration wiederverwendet werden, wenn
sowohl der geprüfte Commit des Arbeitsbranches als auch der Commit von `origin/main`, auf den der Branch
für diesen Prüflauf rebased wurde, unverändert sind. Ergibt der abschließende Abruf von `origin/main`
keinen neuen Stand, ist deshalb kein erneuter Prüflauf erforderlich.

Ist `origin/main` seit dem letzten validierten Rebase fortgeschritten oder wurde der Arbeitsbranch nach
dem Prüflauf geändert, sind nach dem Rebase alle für die Änderung relevanten Prüfungen erneut
auszuführen. Wurde der Branch bereits veröffentlicht, wird der aktualisierte Stand anschließend mit
`--force-with-lease` gesichert.

### Integration nach `main`

Nach erfolgreicher Validierung integriert der verantwortliche Agent seinen eigenen Branch nach `main`.
Die Integration muss eine lineare Historie erhalten und darf nur als Fast-forward erfolgen.

Da jeder Agent in einem eigenen Worktree arbeitet, wechselt er zur Integration nicht auf einen lokalen
`main`-Branch. Stattdessen pusht er den validierten Stand seines Arbeitsbranches mit einem normalen,
nicht erzwungenen Fast-forward-Push direkt auf `origin/main`:

```bash
git fetch origin
# Only if origin/main advanced since the last validated rebase:
git rebase origin/main
# Rerun relevant checks only after rebasing onto a new origin/main commit
git push origin HEAD:main
```

Die Prüfungen nach dem letzten validierten Rebase müssen den tatsächlich zu pushenden Commit-Stand und
dessen Basis auf `origin/main` abdecken. Sind beide seit dem erfolgreichen Prüflauf unverändert, muss der
Prüflauf nicht allein wegen des Integrationsversuchs wiederholt werden. Der Push nach `main` darf
niemals mit `--force` oder `--force-with-lease` erfolgen.

Schlägt `git push origin HEAD:main` fehl, weil ein anderer Agent zwischenzeitlich integriert hat, darf
nicht force-gepusht und kein nicht-linearer Merge erzeugt werden. Der Agent muss stattdessen:

1. den neuen Stand von `origin/main` abrufen,
2. den Arbeitsbranch auf `origin/main` rebasen,
3. Konflikte semantisch lösen,
4. die relevanten Prüfungen erneut ausführen,
5. einen bereits veröffentlichten Arbeitsbranch bei Bedarf mit `--force-with-lease` aktualisieren,
6. den normalen Fast-forward-Push nach `main` erneut versuchen.

Nach erfolgreichem Push ruft der Agent den Remote-Stand erneut ab und weist nach, dass sein Commit in
`origin/main` enthalten ist:

```bash
git fetch origin
git merge-base --is-ancestor HEAD origin/main
```

Damit werden parallele Integrationen optimistisch serialisiert. Ein Agent meldet seinen Auftrag erst als
abgeschlossen, wenn der eigene Commit-Stand nachweislich auf `origin/main` enthalten ist.

Bestehende sinnvolle Commits des Arbeitsbranches bleiben erhalten. Ein Squash ist nur anzuwenden, wenn
der Arbeitsbranch aus unsauberen Zwischen-, Korrektur- oder Experimentiercommits besteht. Ein dafür
notwendiges Umschreiben eines veröffentlichten Arbeitsbranches darf nur mit `--force-with-lease`
gepusht werden.

### Aufräumen des Arbeitsbranches und Worktrees

Erst nachdem der Push nach `main` erfolgreich war und bestätigt wurde, dass der integrierte Commit auf
`origin/main` enthalten ist, werden der kurzlebige Arbeitsbranch und sein Worktree aufgelöst.

Vor dem Entfernen muss bestätigt werden, dass der Worktree keine uncommittierten Änderungen enthält:

```bash
git -C <absolute-worktree-path> status --short
```

Anschließend werden aus einem anderen Checkout des Repositorys zuerst der Worktree und danach der Branch
entfernt:

```bash
git -C <repository-path> worktree remove <absolute-worktree-path>
git -C <repository-path> branch -d <work-branch>
git -C <repository-path> push origin --delete <work-branch>
git -C <repository-path> fetch --prune origin
```

Existiert kein veröffentlichter Remote-Branch, entfällt dessen Löschung. Die Löschung darf nicht vor der
erfolgreichen Integration erfolgen. `git branch -D` ist nur zulässig, wenn zweifelsfrei bestätigt wurde,
dass die enthaltenen Commits bereits auf `origin/main` vorhanden sind oder ausdrücklich verworfen
werden sollen.

### Abschlussbericht

Der Agent nennt am Ende:

- den verwendeten Arbeitsbranch,
- die erstellten Commits,
- die ausgeführten Prüfungen,
- das Ergebnis der Prüfungen,
- ob vorhandene Prüfergebnisse wiederverwendet wurden und welche unveränderten Branch- und
  `origin/main`-Stände dies erlaubt haben,
- ob auf den neuesten Stand von `origin/main` rebased wurde,
- den integrierten Commit auf `main`,
- ob `main` erfolgreich nach `origin` gepusht wurde,
- den verwendeten Worktree,
- ob der Worktree entfernt wurde,
- ob der lokale und der Remote-Arbeitsbranch gelöscht wurden,
- offene Risiken oder nicht ausgeführte Prüfungen.

Der Agent darf nicht behaupten, dass Prüfungen erfolgreich waren, wenn sie nicht tatsächlich ausgeführt
wurden. Ebenso darf er keine erfolgreiche Integration behaupten, solange der Commit nicht auf
`origin/main` nachgewiesen wurde.

## Definition of Done

Eine Änderung ist nur fertig, wenn:

- alle referenzierten Anforderungen umgesetzt sind,
- Unit-, Integrations- und E2E-Tests dem Risiko angemessen vorhanden sind,
- Lint, Typprüfung, Tests und Build erfolgreich sind,
- Berechtigung, Idempotenz, Concurrency und Auditierung geprüft wurden,
- öffentliche und operative Zustände im Browser geprüft wurden,
- Traceability und Dokumentation aktualisiert wurden,
- keine personenbezogenen Daten oder Secrets in Diff, Logs oder Testfixtures auftauchen,
- der finale Diff auf Regressionen und Datenexposition geprüft wurde,
- der Arbeitsbranch auf dem neuesten Stand von `origin/main` validiert wurde,
- die Änderung per Fast-forward nach `main` integriert und zu `origin/main` gepusht wurde,
- der auftragsbezogene Worktree nach bestätigter Integration entfernt wurde,
- der kurzlebige Arbeitsbranch nach bestätigter Integration lokal und remote aufgeräumt wurde.

## Hochkritische Review-Funde

Behandle insbesondere als hohe oder kritische Priorität:

- mögliche doppelte Tickets, Flüge oder Zustandsübergänge,
- Verletzung des Gruppenschutzes,
- gleichzeitige aktive Zuordnung eines Flugzeugs zu mehreren Ressourcengruppen,
- akzeptierte stale writes,
- fehlende Audit-Ereignisse,
- personenbezogene Daten oder öffentliche Tokens in Logs,
- sicherheitsbezogene Freigabesemantik,
- unautorisierte operative Kommandos,
- aufzählbare öffentliche Ticketcodes,
- Änderungen, die Offline-Wiederherstellung oder Live-Synchronisation beschädigen.
