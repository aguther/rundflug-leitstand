# Komplexität der Worker-Orchestrierung

- **Status:** offen
- **Priorität:** mittel
- **Evidenz:** `master-data-command-service.ts` umfasst 1.218 logische Zeilen,
  `operations-read-service.ts` 862 und `operations-routes.ts` 966. Mehrere Handler bündeln weiterhin
  entitätsspezifische Validierung, Projektion und Persistenzplanung.

## Wirkung

Die verbleibenden Orchestratoren besitzen große Änderungsflächen in besonders sensiblen Bereichen:
aktive Ressourcenzuordnung, Gruppenschutz, Analyseprojektion und das operative Read Model. Rein
mechanische Aufteilung könnte Kontroll- oder Persistenzgrenzen unsichtbar verändern.

## Sicherer Abbau

Stammdaten werden nach Gate/Produkt und Ressource/Flugzeug in typisierte Entscheidungs- und
Persistenzpläne getrennt. Operations-Routen werden auf Transport und Response-Mapping reduziert;
Boardprojektionen bleiben reine, vorindizierte Abbildungen. Autorisierung, erwartete Version,
Idempotenz, Audit, Outbox und Persist-before-publish bleiben unverändert und werden vor jeder
Extraktion durch Verhaltenstests abgesichert.

## Abschlusskriterium

Die benannten Dateien liegen innerhalb abgesenkter Ratchets, entitätsspezifische Entscheidungen sind
isoliert testbar und alle Rollen-, Konflikt-, Invarianten-, Audit- und Persistenznachweise bestehen
unverändert.
