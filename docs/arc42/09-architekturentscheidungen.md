# 9. Architekturentscheidungen

Alle strukturprägenden Entscheidungen liegen als eigenständige ADRs unter `docs/adr/`. Diese Tabelle
ist die Übersicht; verbindlich ist jeweils der ADR-Text mit Kontext, Alternativen und Konsequenzen.

| ADR | Entscheidung | Architektonische Wirkung |
| --- | --- | --- |
| [0001](../adr/0001-cloudflare-worker-static-assets.md) | Cloudflare Worker mit Static Assets statt reinem Pages-Projekt | ein Deployment-Artefakt für API und PWA; `run_worker_first` für `/api/*` und Rollenpfade |
| [0002](../adr/0002-d1-und-durable-object.md) | D1 als Source of Truth, Durable Object als serieller Koordinator | Konsistenzgrenze je Veranstaltung; Grundlage für Idempotenz und Versionsprüfung |
| [0003](../adr/0003-eu-jurisdiktion.md) | EU-Jurisdiktion für persistente Cloudflare-Daten | `jurisdiction("eu")` für DO und R2; Restfrage zu Metadaten bleibt in OQ-06 offen |
| [0004](../adr/0004-backup-und-wiederherstellung.md) | Zweistufige Sicherung aus D1 Time Travel und portablem R2-Export | Wiederherstellbarkeit ohne Anbieterbindung; geprüfter Restore-Pfad |
| [0005](../adr/0005-offline-konflikte.md) | Offline-Queue nur für lokal reversible Entwürfe, sichtbare Konfliktauflösung | operative Kommandos benötigen Serverbestätigung; keine automatische Zusammenführung |
| [0006](../adr/0006-vollstaendig-anonyme-identitaeten.md) | Vollständig anonyme Identitäten | keine Gastnamen; öffentliche Codes ausschließlich als Hash im Kernsystem |
| [0007](../adr/0007-eine-cloudflare-abnahmeumgebung.md) | Genau eine Abnahmeumgebung bis zur Produktionsfreigabe | Produktion ist ein Gate mit eigener D1, eigenem R2-Bucket und getrennten Secrets |
| [0008](../adr/0008-abgeleitete-kapazitaet-und-vereinfachter-betrieb.md) | Abgeleitete Kapazität und vereinfachter operativer Ablauf | weniger Pflichtfelder am Veranstaltungstag; Kapazität entsteht rechnerisch |
| [0009](../adr/0009-mehrflaechenbetrieb-und-automatischer-voraufruf.md) | Mehrflächenbetrieb, automatischer Voraufruf, öffentliche Anzeigen | mehrere Ressourcengruppen parallel; Voraufruf ohne Ressourcenbindung |
| [0010](../adr/0010-anonyme-helferkonten-und-sitzungen.md) | Anonyme Helferkonten mit serverseitigen Sitzungen, teilweise ersetzt | Rollen statt Personen; widerrufbare Sitzungen und Gerätekopplung bleiben, Laufzeiten folgen V15-AUTH-010, V173-SES-010 und ADR-0021 |
| [0011](../adr/0011-v1-2-designsystem-und-web-modularisierung.md) | Designsystem und modulare Webanwendung | verbindliche Modulgrenzen; `App.tsx` nur Komposition und Routing |
| [0012](../adr/0012-flugzeugzentrierte-abfertigung-und-adaptiver-voraufruf.md) | Flugzeugzentrierte Abfertigung, adaptiver Voraufruf | Umlauf und Flugzeugzustand sind gekoppelt; Bindung erst bei `CALL_NEXT` |
| [0013](../adr/0013-expliziter-veranstaltungskontext-und-displaybindung.md) | Expliziter Veranstaltungskontext und Displaybindung | jeder Client arbeitet in genau einem Veranstaltungskontext |
| [0014](../adr/0014-explizite-buchungsgruppenkomposition.md) | Explizite Komposition vollständiger Buchungsgruppen | Gruppen werden nie automatisch getrennt; Aufteilung nur als bewusste Verkaufsaktion |
| [0015](../adr/0015-konsistente-veranstaltungslogos.md) | Veranstaltungslogos konsistent in R2 und D1 | einheitliche Darstellung auf Ticket, FIDS und Statusseite |
| [0016](../adr/0016-reset-first-veranstaltungslebenszyklus.md) | Reset-first-Lebenszyklus und öffentliches FIDS | definierter Neuaufbau statt gewachsener Restzustände |
| [0017](../adr/0017-kassenkorrektur-druck-und-releaseversion.md) | Kassenkorrektur, Ticketdruck und konsistente Releaseversion | Korrektur als Storno und Neuverkauf; Version als gemeinsame Wahrheit |
| [0018](../adr/0018-separate-pilotenzuweisung-und-kompakte-flight-line.md) | Separate Pilotenzuweisung, kompakte Flight Line | Pilotenbindung getrennt vom Flugzeug; mobiler Ein-Bildschirm-Ablauf |
| [0019](../adr/0019-getrennte-assist-auswahl-und-arbeitsansicht.md) | Getrennte Auswahl- und Arbeitsansicht für Unterstützungsaufgaben | weniger Fehlbedienung durch klar getrennte Bildschirmzustände |
| [0020](../adr/0020-transiente-und-persistente-ui-meldungen.md) | Transiente und persistente UI-Meldungen, teilweise ersetzt | Trennung bleibt; gemeinsame Overlay-Fläche wurde durch ADR-0047 ersetzt |
| [0021](../adr/0021-display-konten-und-fids-einstellungen.md) | Display-Konten und kontobezogene FIDS-Einstellungen | Monitore laufen mit eigener Rolle ohne operative Rechte |
| [0022](../adr/0022-getrennte-buchungs-und-fluggruppenkennungen.md) | Getrennte Buchungs- und Fluggruppenkennungen | Verkaufsvorgang und Kommunikationsnummer bleiben unabhängig |
| [0023](../adr/0023-oeffentlicher-gruppencode.md) | Öffentlicher Gruppencode statt sichtbarer Personencodes | eine Gruppe teilt einen anonymen Statuszugang |
| [0024](../adr/0024-mobiler-status-und-ios-web-push.md) | Mobiler öffentlicher Status und iOS-Web-Push | deklarative Push-Nachrichten, Ursprung je Abonnement gespeichert |
| [0025](../adr/0025-aggregatbezogene-kommandos-und-entkoppelte-aktualisierung.md) | Aggregatbezogene Kommandos und entkoppelte Aktualisierung | Versionssignal statt Datenverteilung über den WebSocket |
| [0026](../adr/0026-veranstaltungsbezogene-administration-und-stammdatenvorlagen.md) | Veranstaltungsbezogene Administration und portable Vorlagen | Stammdaten sind exportier- und wiederverwendbar |
| [0027](../adr/0027-portable-cloudflare-ziele-und-reset-fortsetzung.md) | Portable Cloudflare-Ziele und wiederaufnehmbarer Reset | Neuaufbau ohne fest kodierte Ressourcen-IDs |
| [0028](../adr/0028-zeitabhaengige-prognose-und-weicher-betriebsplan.md) | Zeitabhängige Prognose und weicher Betriebsplan | geplante Einschränkungen wirken nur auf die Prognose, nie auf Zustände |
| [0029](../adr/0029-kapazitaetsgetriebener-voraufruf-und-prepare.md) | Kapazitätsgetriebener Voraufruf und öffentlicher Vorbereitungsstatus | Gäste werden erst gerufen, wenn Kapazität absehbar ist |
| [0030](../adr/0030-produktbezogenes-zeitmodell-und-referenz-umlaufzeit.md) | Produktbezogenes Zeitmodell, abgeleitete Referenz-Umlaufzeit | Planzeit liegt am Produkt; Ressourcengruppe besitzt keine eigene Zeit |
| [0031](../adr/0031-komponentenweise-umlaufzeit-hierarchie.md) | Komponentenweise Umlaufzeit-Hierarchie | Auflösung über Flugzeug + Produkt, Produkt und Veranstaltung; löst Teile von ADR-0030 ab |
| [0032](../adr/0032-durchsatz-und-fairnessorientierte-dispatch-planung.md) | Durchsatz- und fairnessorientierte Dispatch-Planung | begrenzte kombinatorische Optimierung als versionierte Empfehlung |
| [0033](../adr/0033-skalierbare-kurz-und-langzeitprognose.md) | Skalierbare Kurz- und Langzeitprognose | naher Horizont optimiert, ferner Horizont deterministisch linear |
| [0034](../adr/0034-analysis-and-replay-export.md) | Support-sichere Analyseexporte und deterministischer Replay | Allowlist-Projektionen, inhaltsadressierte Planungschunks, R2-Tagesarchive |
| [0035](../adr/0035-kurzlebige-dispatch-vorschlagsreservierung.md) | Kurzlebige Reservierung von Dispatch-Vorschlägen | verhindert doppelte Bearbeitung derselben Empfehlung |
| [0036](../adr/0036-optionale-fids-zusammenfassung-gemeinsamer-fluege.md) | Optionale FIDS-Zusammenfassung gemeinsamer Flüge | lesbarere Monitore ohne Verlust der Einzelinformation |
| [0037](../adr/0037-teilflug-suffixe-in-konkreten-umlaufzeilen.md) | Teilflug-Suffixe in konkreten Umlaufzeilen | eindeutige Kommunikation bei aufgeteilten Buchungsgruppen |
| [0038](../adr/0038-eigenstaendiger-gruppennachruf.md) | Eigenständiger aktiver Gruppennachruf | Nachruf ist kein Ticketzustand; eigene Persistenz und Projektion |
| [0039](../adr/0039-kontobezogene-fids-modi-url-seiten-filter-und-simulation.md) | Kontobezogene FIDS-Modi, URL-Seiten, Filter und gemeinsame Simulation | Monitorseiten aus der URL, Filter ausschließlich im geschützten Dialog |
| [0040](../adr/0040-serverseitige-oeffentliche-codevergabe.md) | Serverseitige Vergabe öffentlicher Statuscodes | reguläre Verkäufe akzeptieren keine Clientcodes; Worker-Vergabe, Kollisionsprüfung und idempotenter Beleg |
| [0041](../adr/0041-modulare-forecast-pipeline-und-legacy-abschaltung.md) | Modulare Forecast-Pipeline und Legacy-Abschaltung | explizite Adapter- und Domain-Phasen, Persist-before-publish und messbares Abschaltkriterium |
| [0042](../adr/0042-modulare-deterministische-simulationspipeline.md) | Modulare deterministische Simulationspipeline | gemeinsame Seed-Primitive und fachliche Phasen für Legacy-/Operational-Simulation; operative Tests sind Teil der Coverage |
| [0043](../adr/0043-familienvertraege-und-isoliertes-worker-testharness.md) | Familienverträge und isoliertes Worker-Testharness | kompatible Operations-Fassade mit vier Command-Familien; parallele lokale Verifier ohne geteilten Port oder D1-Zustand |
| [0044](../adr/0044-eigenstaendiger-simulations-fids-tab.md) | Eigenständiger Simulations-FIDS-Tab mit lokalem Zustandskanal | direkte Route ohne Popup-/Portal-Kopplung; versionierte flüchtige Tab-Synchronisation ohne Backend oder Browser-Storage |
| [0045](../adr/0045-d1-v1-12-schema-baseline.md) | Inkompatible D1-Schema-Baseline für V1.12 | eine ausführbare Baseline statt 69 Entwicklungsmigrationen; künftige Nummerierung eindeutig und lückenlos ab `0002` |
| [0046](../adr/0046-verhaltensbasierte-testarchitektur.md) | Verhaltensbasierte Testarchitektur und Qualitätsratchets | keine TypeScript-Quelltexttests; ausführbare Domain-, SQLite-, Runtime-, DOM- und Browsergrenzen sowie Coverage- und Mutation-Ratchets |
| [0047](../adr/0047-operative-ui-shell-und-bewusste-pwa-updates.md) | Operative UI-Shell und bewusste PWA-Updates | persistente Inline-Hinweise, mobile Sticky-Geometrie, expliziter Update-Reload und sicherer Routing-Fallback |
| [0048](../adr/0048-rollenbezogene-web-chunks-und-precache.md) | Rollenbezogene Web-Chunks und begrenzter PWA-Precache | dünne Route-Shells, getrennte Flight-Line-/Flight-Director-Styles und Online-only-Administration im Precache |

## Offene Entscheidungen

`docs/requirements/open-questions.md` führt die noch offenen fachlichen Fragen. Für die Architektur
besonders relevant:

- **OQ-01** – endgültiger Umfang offline zulässiger Aktionen; aktuell bewusst restriktiv umgesetzt.
- **OQ-06** – abschließende datenschutzrechtliche Bewertung der EU-Verarbeitung inklusive
  Infrastruktur-Metadaten; blockiert zusammen mit R-06 die Produktionsfreigabe.
