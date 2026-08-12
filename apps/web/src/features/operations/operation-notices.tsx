import { PageNotice } from "../../app/PageNotifications";
import { confirmedStateLabel } from "../../offline-store";

export function ConnectionNotice({
  error,
  lastConfirmedAt,
}: {
  error: string | null;
  lastConfirmedAt?: string | null;
}) {
  return error ? (
    <PageNotice noticeKey={`connection:${lastConfirmedAt ?? "none"}:${error}`} tone="warning">
      Möglicherweise veraltet
      {lastConfirmedAt ? ` · ${confirmedStateLabel(lastConfirmedAt)}` : " · kein bestätigter Stand"}
      {` · ${error}`}
    </PageNotice>
  ) : null;
}

export function EmergencyNotice({ active }: { active: boolean }) {
  return active ? (
    <PageNotice noticeKey="emergency-active" tone="danger">
      <strong>Notfallmodus aktiv</strong> · keine Verkäufe oder neuen Aufrufe
    </PageNotice>
  ) : null;
}

export function InterruptionNotice({ active }: { active: boolean }) {
  return active ? (
    <PageNotice noticeKey="operation-interrupted" tone="warning">
      <strong>Flugbetrieb unterbrochen</strong> · keine Verkäufe oder neuen Aufrufe; laufende Flüge
      bleiben dokumentierbar
    </PageNotice>
  ) : null;
}

export function OperationalNotice({ note }: { note: string | null | undefined }) {
  return note ? (
    <PageNotice noticeKey={`operational-note:${note}`} tone="info">
      <strong>Betriebshinweis:</strong> {note}
      <small>Organisatorische Information ohne Sicherheits- oder Freigabewirkung.</small>
    </PageNotice>
  ) : null;
}
