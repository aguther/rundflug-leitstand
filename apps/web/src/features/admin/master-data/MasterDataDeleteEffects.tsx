import { CheckCircle2 } from "lucide-react";
import type { MasterDataDeleteTarget } from "../../../operation-workspace";

export function MasterDataDeleteEffects({
  preparation,
  target,
}: Readonly<{ preparation: boolean; target: MasterDataDeleteTarget }>) {
  if (!preparation) {
    return (
      <output className="delete-blockers">
        <strong>Löschen ist nach Betriebsfreigabe gesperrt.</strong>
        <span>Stammdaten können jetzt nur noch deaktiviert werden.</span>
      </output>
    );
  }
  if (target.blockers.length > 0) {
    return (
      <output className="delete-blockers">
        <strong>Löschen noch nicht möglich</strong>
        <span>Zuerst entfernen:</span>
        <ul>
          {target.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </output>
    );
  }
  return (
    <div className="delete-ready-copy">
      <CheckCircle2 aria-hidden="true" />
      <span>Keine erkennbaren Abhängigkeiten. Der Server prüft sie vor dem Löschen erneut.</span>
    </div>
  );
}
