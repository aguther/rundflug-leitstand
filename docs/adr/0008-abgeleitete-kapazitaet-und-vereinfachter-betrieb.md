# ADR-0008: Abgeleitete Kapazität und vereinfachter operativer Ablauf

- Status: Akzeptiert
- Datum: 2026-07-16
- Entscheidung: Auftraggeber
- Betroffene Anforderungen: F-KAS-060, F-KAS-130, F-RES-060, F-RES-090, F-SLT-020,
  F-SLT-070, F-SLT-120, F-BRD-010, F-BRD-030, D-015, D-020

## Kontext

Die Abnahme der bisherigen V1-Oberfläche zeigte, dass manuell gepflegte Referenzkapazitäten,
Freitext-Kompatibilität, eine primäre Pilotenauswahl an der Flight Line und informatorische
Zahlungsfelder den operativen Ablauf unnötig komplizieren. Insbesondere konnten manuelle
Referenzwerte der real verfügbaren gemischten Flotte widersprechen und dadurch verfrühte
Teilungswarnungen auslösen.

## Entscheidung

### Kapazität und Kompatibilität

- Die Kapazität einer Ressourcengruppe wird nicht manuell gepflegt. Sie wird aus ihren aktiven,
  konkret zugeordneten Flugzeugen abgeleitet.
- Die größte ohne Teilung transportierbare Gruppe entspricht der höchsten Passagierkapazität eines
  aktuell nutzbaren Flugzeugs der Ressourcengruppe.
- Freitextlisten kompatibler Flugzeugtypen entfallen. Die konkrete Flugzeugauswahl in der
  Ressourcengruppe ist die verbindliche Zuordnung.
- Ohne mindestens ein aktives zugeordnetes Flugzeug ist eine Ressourcengruppe nicht verkaufsbereit.
- Eine Gruppe wird nur dann als teilungsbedürftig behandelt, wenn kein aktuell nutzbares Flugzeug der
  Ressourcengruppe sie vollständig aufnehmen kann.

### Disposition gemischter Kapazitäten

- Zunächst werden nur Flugzeuge betrachtet, deren Passagierkapazität die vollständige Fluggruppe
  aufnehmen kann.
- Unter diesen Flugzeugen wird die früheste realistische Verfügbarkeit priorisiert.
- Bei hinreichend ähnlicher Verfügbarkeit wird das kleinste ausreichend große Flugzeug bevorzugt, um
  größere Flugzeuge für größere Gruppen verfügbar zu halten.
- Passt eine Gruppe nur in einen Teil der Flotte, zeigt die Kasse eine mögliche längere Wartezeit,
  aber keine Teilungswarnung.
- Der Vorschlag bleibt bis `NEXT` flexibel. `NEXT` bestätigt Flugzeug und den am Flugzeug hinterlegten
  Pilotencode. Danach erfolgen Änderungen nur bestätigt und protokolliert.

### Rollen der Oberfläche

- Die Flight Line arbeitet primär mit Flugzeugen. Der aktuelle Pilotencode wird automatisch aus dem
  Flugzeugzustand übernommen; ein Pilotwechsel ist eine sekundäre Abweichungsaktion.
- Die Kasse weist weder Flugzeug noch Pilot zu.
- Gates sind in V1 benannte operative beziehungsweise öffentliche Orte. Die technischen Typen
  `FLIGHT_LINE`, `BOARDING` und `DISPLAY_ONLY` werden in der Bedienoberfläche durch den einfachen
  Schalter „Auf öffentlichen Anzeigen zeigen“ ersetzt.

### Zahlungsinformationen

- Zahlungsstatus und Zahlart werden nicht mehr im Rundflug-Leitstand erfasst. Preisangaben können als
  Produktinformation bestehen bleiben, besitzen aber keine Wirkung auf Ticket, Queue oder Prognose.
- Die bisherigen Anforderungen F-KAS-060 und der zahlartbezogene Teil von F-KAS-130 werden durch diese
  Auftraggeberentscheidung aufgehoben.

### Administration

- Normale Änderungen benötigen keine manuelle Begründung. Das Audit enthält Geräte-ID, Änderung,
  Zeitpunkt und Version.
- Eine Begründung bleibt nur für irreversible oder außergewöhnliche Eingriffe erforderlich, etwa
  Werksreset, Abbruch oder manuelle Besetzungskorrektur.
- Pilotencodes beginnen standardmäßig bei `P-01`.

## Folgen

F-SLT-070, D-015 und D-020 werden so interpretiert, dass ein technischer Referenzwert als abgeleiteter
Snapshot für Fluggruppenbildung und Prognose gespeichert werden darf, aber nicht mehr separat durch
Benutzer gepflegt wird. Die Disposition muss gemischte Kapazitäten bei Vorschlag und Wartezeit
berücksichtigen. Migrationen müssen bestehende Daten weiterhin lesen können; veraltete manuelle
Referenzwerte dürfen keine operative Entscheidung mehr treiben.

Die UI-Freigabe ist in `docs/ui/v1-simplified-operations.md` dokumentiert.
