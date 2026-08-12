import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useState } from "react";
import { createMasterEditorSnapshot } from "../../../admin-master-editor-state";

type Aircraft = OperationBoard["aircraft"][number];

export interface AircraftEditorDraft {
  editorId: string;
  maximumPassengerPayloadKg: string;
  passengerSeats: number;
  registration: string;
  type: string;
}

function snapshotForAircraft(draft: AircraftEditorDraft): string {
  return createMasterEditorSnapshot([
    "aircraft",
    draft.registration,
    draft.type,
    draft.passengerSeats,
    draft.maximumPassengerPayloadKg,
  ]);
}

export function useAircraftEditorState(board: OperationBoard | null | undefined) {
  const [editorId, setEditorId] = useState("new");
  const [registration, setRegistration] = useState("");
  const [type, setType] = useState("");
  const [passengerSeats, setPassengerSeats] = useState(3);
  const [maximumPassengerPayloadKg, setMaximumPassengerPayloadKg] = useState("");

  const draft: AircraftEditorDraft = {
    editorId,
    maximumPassengerPayloadKg,
    passengerSeats,
    registration,
    type,
  };
  const currentAircraft: Aircraft | undefined = board?.aircraft.find(
    (aircraft) => aircraft.id === editorId,
  );
  const snapshot = snapshotForAircraft(draft);

  const select = useCallback(
    (id: string): string => {
      const entry = board?.aircraft.find((aircraft) => aircraft.id === id);
      const nextDraft: AircraftEditorDraft = {
        editorId: id,
        maximumPassengerPayloadKg: entry?.maximumPassengerPayloadKg?.toString() ?? "",
        passengerSeats: entry?.passengerSeats ?? 3,
        registration: entry?.registration ?? "",
        type: entry?.aircraftType ?? "",
      };
      setEditorId(nextDraft.editorId);
      setRegistration(nextDraft.registration);
      setType(nextDraft.type);
      setPassengerSeats(nextDraft.passengerSeats);
      setMaximumPassengerPayloadKg(nextDraft.maximumPassengerPayloadKg);
      return snapshotForAircraft(nextDraft);
    },
    [board],
  );

  const updateRegistration = useCallback((value: string) => {
    setRegistration(value.toUpperCase());
  }, []);

  return {
    ...draft,
    currentAircraft,
    select,
    setMaximumPassengerPayloadKg,
    setPassengerSeats,
    setRegistration: updateRegistration,
    setType,
    snapshot,
  };
}
