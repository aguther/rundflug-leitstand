# Administration V3 – freigegebenes Oberflächen- und Löschkonzept

Freigegeben am 13. Juli 2026. Visuelle Referenzen:

- `admin-v3-desktop-light-approved.png`
- `admin-v3-desktop-dark-delete-approved.png`
- `admin-v3-mobile-dark-approved.png`

## Gestaltungsprinzipien

Die Administration verwendet eine kompakte, ruhige Arbeitsoberfläche ohne Karten-Dashboard.
Stammdatenkategorien liegen als horizontale Reiter direkt über einer durchsuchbaren Tabelle. Ein
Klick auf eine Tabellenzeile öffnet den Editor rechts; auf kleinen Bildschirmen wird daraus ein
Bottom-Sheet. Neuanlage und Bearbeitung folgen damit demselben Ablauf. Primäraktionen sind blau,
endgültige Aktionen ausschließlich rot. Radien bleiben mit 6 bis 8 Pixeln zurückhaltend.

Hell- und Dunkelmodus verwenden dieselbe Informationshierarchie. Die Auswahl wird lokal auf dem
Gerät gespeichert. Die mobile Administration besitzt eine feste untere Bereichsnavigation, horizontal
scrollbare Stammdatenkategorien und zeilenförmige Datensätze ohne horizontales Seiten-Scrolling.

## Freigegebene Kompakt- und Theme-Korrektur

Am 13. Juli 2026 wurde ergänzend freigegeben:

- Alle administrativen Flächen verwenden auch im Dunkelmodus ausschließlich semantische
  Theme-Farben. Dies umfasst Kennzahlen, PIN-Bereiche, Hinweise, deaktivierte Aktionen und die
  Fußzeile.
- Reiter, Suche und Tabellenkopf bleiben beim Kategorienwechsel an derselben Position. Die
  Stammdatentabelle besitzt eine kompakte, begrenzte Arbeitsfläche mit internem Scrollen und
  stabiler Scrollbar; unterschiedliche Zeilenzahlen verschieben die Bedienoberfläche nicht.
- Tabellenzeilen bleiben kompakt, leere Kategorien verwenden keinen großflächigen Leerzustand.
- Datumsfelder werden deutsch als `TT.MM.JJJJ` angeboten. Kombinierte Zeitpunkte verwenden
  getrennte Datums- und Zeitfelder, wobei die Zeit im 24-Stunden-Format `HH:mm` eingegeben wird.
  Die intern verwendeten ISO-Werte und die Veranstaltungszeitzone bleiben unverändert.

## Endgültiges Löschen

Anforderung `F-ADM-050` gilt für Gates, Ressourcengruppen, Flugzeuge, deren Zuordnungen,
Pilotencodes und Produkte:

- Hard Delete ist ausschließlich in der Veranstaltungsphase `PREPARATION` möglich.
- Eine Administrator-PIN ist immer erforderlich; eine zusätzliche manuelle Begründungseingabe ist
  nicht nötig. Der einheitliche Grund lautet `Administrative Stammdatenlöschung`.
- Der Client zeigt bekannte Abhängigkeiten vorab. Maßgeblich ist immer die erneute Serverprüfung.
- Abhängige Tickets, Fluggruppen, Umläufe, Produkte, Ressourcengruppen, Flugzeugzuordnungen oder
  Pilotbindungen blockieren die Löschung.
- Das Entfernen einer Flugzeugzuordnung löscht in der Vorbereitung die bisherige
  Zuordnungshistorie dieses Flugzeugs für die aktuelle Veranstaltung. Flugzeug und
  Ressourcengruppe bleiben erhalten.
- Nach Betriebsfreigabe bleibt die fachliche Historie unverändert. Wo unterstützt, werden
  Stammdaten stattdessen deaktiviert.
- Jeder akzeptierte Befehl prüft die erwartete Version, ist idempotent und persistiert Löschung,
  Audit-Ereignis, Idempotenzbeleg und Outbox in einer gemeinsamen D1-Batch-Grenze.

## Prüfumfang

Die Implementierung wird auf Desktop und Mobil in Hell- und Dunkelmodus geprüft. Zusätzlich deckt
der Stammdaten-Integrationstest gültige Löschung, ungültige PIN, Abhängigkeitsblockade,
Phasensperre und Auditierung mit ausschließlich synthetischen Daten ab.
