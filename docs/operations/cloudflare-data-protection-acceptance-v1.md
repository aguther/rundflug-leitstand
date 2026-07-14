# Cloudflare-Datenschutzabnahme V1

Stand: 14. Juli 2026

Betroffene Anforderung: Q-DSG-040. Fachentscheidung: OQ-06.

Dieses Protokoll ist eine technische und organisatorische Prüfhilfe, keine Rechtsberatung. Die
rechtsverbindliche Bewertung und Freigabe verbleibt beim Verantwortlichen beziehungsweise dessen
Datenschutzberatung.

## 1. Aktueller belegter Stand

- D1, R2 und der veranstaltungsbezogene Durable-Object-Zustand sind technisch auf die
  EU-Jurisdiktion konfiguriert und im realen Cloudflare-Account entsprechend geprüft.
- Die Anwendung läuft derzeit über `rundflug-leitstand.andreas-7f3.workers.dev`, nicht über eine
  regionalisierte Custom Domain.
- Cloudflare dokumentiert, dass eine geografisch beschränkte TLS-Terminierung und Worker-Ausführung
  „Regional Services“ auf einer Workers Custom Domain voraussetzt.
- Die Data Localization Suite einschließlich Regional Services ist laut Cloudflare ein
  Enterprise-Zusatz. Die Customer Metadata Boundary für EU-Logs und -Analysen ist eine zusätzliche,
  getrennte Einstellung.
- Regional Services gilt laut Cloudflare nicht für Worker-Subrequests oder andere Trigger wie Cron.
  Daraus folgt für diese Anwendung: Selbst eine regionalisierte Custom Domain belegt nicht
  automatisch eine ausschließlich europäische Zustellung an externe Browser-Push-Endpunkte oder die
  Ausführung des täglichen Cron-Triggers.

Damit ist die streng freigegebene Forderung „gesamte Verarbeitung einschließlich Worker-, TLS-,
Push- und Netzwerkmetadaten ausschließlich in der EU“ im aktuellen Self-Service-Setup **nicht
nachgewiesen**. EU-Jurisdiktion für D1/R2/DO allein genügt dafür ausdrücklich nicht.

## 2. Offizielle Cloudflare-Vertragsquellen

- Cloudflare Customer DPA, Version 6.4, wirksam seit 3. April 2026:
  <https://www.cloudflare.com/en-gb/cloudflare-customer-dpa/>
- Aktuelle Cloudflare-Subprozessoren für Cloudflare-Dienste:
  <https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/>
- Data Localization Suite:
  <https://developers.cloudflare.com/data-localization/>
- Regional Services für Workers:
  <https://developers.cloudflare.com/data-localization/how-to/workers/>

Das DPA sieht mögliche Verarbeitung außerhalb des EWR und dafür Transfermechanismen vor. Die
Subprozessorliste enthält für die Cloudflare Developer Platform und Supportleistungen auch Standorte
außerhalb des EWR. Das ist ein anderer Schutzansatz als die hier fachlich geforderte ausschließliche
EU-Verarbeitung.

## 3. Erforderliche Betreiberentscheidung vor Produktion

Genau eine der folgenden Richtungen muss ausdrücklich beschlossen und dokumentiert werden:

1. **Strenge EU-Anforderung beibehalten:** Enterprise-Angebot mit Regional Services auf einer Custom
   Domain und Customer Metadata Boundary EU beschaffen; Cloudflare muss zusätzlich schriftlich
   bestätigen, wie Cron, Durable Objects, D1, R2, Supportzugriffe und Web-Push-Subrequests die Vorgabe
   erfüllen. Erst danach technisch konfigurieren und durch regionale Ausführungsnachweise abnehmen.
2. **Anforderung formal ändern:** Statt ausschließlicher EU-Verarbeitung werden DSGVO-konforme
   Drittlandtransfers mit DPA, SCC/DPF, Transferfolgenabschätzung und dokumentierter
   Subprozessorprüfung akzeptiert. Dies ist eine fachliche/rechtliche Änderung von OQ-06 und darf
   nicht allein durch Implementierung oder Deployment erfolgen.
3. **Betriebsplattform ändern:** Verarbeitung und Push-Zustellung auf eine nachweislich vollständig
   EU-begrenzte Plattform verlagern. Die vorhandenen Domain-, Contract- und Adaptergrenzen sowie
   portable D1-/R2-Exporte dienen als Migrationsbasis.

## 4. Auszufüllendes Freigabeprotokoll

| Prüfschritt | Nachweis/Entscheidung | Status |
| --- | --- | --- |
| Verantwortlicher und Cloudflare-Vertragspartner benannt |  | offen |
| DPA-Version, Abrufdatum und Vertragsgeltung archiviert |  | offen |
| aktuelle Subprozessorliste geprüft und RSS-Änderungen abonniert |  | offen |
| Rechtsgrundlagen und Transfermechanismen bewertet |  | offen |
| gewählte Richtung 1, 2 oder 3 ausdrücklich beschlossen |  | offen |
| Worker-/TLS-Ausführungsregion technisch nachgewiesen |  | offen |
| Customer Metadata Boundary beziehungsweise gleichwertiger Nachweis |  | offen |
| Cron-, Support- und Observability-Verarbeitung bewertet |  | offen |
| Browser-Web-Push-Anbieter und Worker-Subrequests bewertet |  | offen |
| Verzeichnis der Verarbeitungstätigkeiten vervollständigt |  | offen |
| Datum, prüfende Person und Produktionsfreigabe dokumentiert |  | offen |

Q-DSG-040 bleibt bis zur vollständigen Bearbeitung dieses Protokolls auf `in Arbeit`; die aktuelle
Cloudflare-Umgebung darf unter der streng freigegebenen OQ-06-Auslegung nicht als Produktion
freigegeben werden.
