import type { OperationBoard } from "@rundflug/contracts";
import { useCallback, useState } from "react";
import { createMasterEditorSnapshot } from "../../../admin-master-editor-state";
import { formatEuroInput, parseEuroToCents } from "../../../product-editor";

type Product = OperationBoard["products"][number];
type WeightClass = Product["weightClasses"][number];

export interface ProductEditorDraft {
  boardingOverride: string;
  bufferOverride: string;
  childCompanion: boolean;
  code: string;
  deboardingOverride: string;
  description: string;
  editorId: string;
  gateId: string;
  name: string;
  priceInput: string;
  promisedFlightMinutes: number;
  referenceDuration: number;
  resourceGroupId: string;
  weightClasses: WeightClass[];
}

function snapshotForProduct(draft: ProductEditorDraft): string {
  return createMasterEditorSnapshot([
    "products",
    draft.name,
    draft.code,
    draft.description,
    draft.resourceGroupId,
    draft.gateId,
    draft.priceInput,
    draft.referenceDuration,
    draft.promisedFlightMinutes,
    draft.boardingOverride,
    draft.deboardingOverride,
    draft.bufferOverride,
    draft.childCompanion,
    draft.weightClasses,
  ]);
}

export function useProductEditorState(board: OperationBoard | null | undefined) {
  const [editorId, setEditorId] = useState("new");
  const [name, setName] = useState("");
  const [code, setCodeState] = useState("");
  const [description, setDescription] = useState("");
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [gateId, setGateId] = useState("");
  const [priceInput, setPriceInput] = useState("0,00 €");
  const [referenceDuration, setReferenceDuration] = useState(20);
  const [promisedFlightMinutes, setPromisedFlightMinutes] = useState(20);
  const [boardingOverride, setBoardingOverride] = useState("");
  const [deboardingOverride, setDeboardingOverride] = useState("");
  const [bufferOverride, setBufferOverride] = useState("");
  const [childCompanion, setChildCompanion] = useState(false);
  const [weightClasses, setWeightClasses] = useState<WeightClass[]>(["NOT_CAPTURED"]);

  const draft: ProductEditorDraft = {
    boardingOverride,
    bufferOverride,
    childCompanion,
    code,
    deboardingOverride,
    description,
    editorId,
    gateId,
    name,
    priceInput,
    promisedFlightMinutes,
    referenceDuration,
    resourceGroupId,
    weightClasses,
  };
  const priceCents = parseEuroToCents(priceInput);
  const snapshot = snapshotForProduct(draft);

  const select = useCallback(
    (id: string): string => {
      const entry = board?.products.find((product) => product.id === id);
      const nextDraft: ProductEditorDraft = {
        boardingOverride: entry?.plannedBoardingMinutesOverride?.toString() ?? "",
        bufferOverride: entry?.plannedBufferMinutesOverride?.toString() ?? "",
        childCompanion: entry?.childCompanionRequired ?? false,
        code: entry?.code ?? "",
        deboardingOverride: entry?.plannedDeboardingMinutesOverride?.toString() ?? "",
        description: entry?.publicDescription ?? "",
        editorId: id,
        gateId: entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "",
        name: entry?.name ?? "",
        priceInput: formatEuroInput(entry?.priceCents ?? 0),
        promisedFlightMinutes: entry?.promisedFlightMinutes ?? 20,
        referenceDuration: entry?.referenceDurationMinutes ?? 20,
        resourceGroupId: entry?.resourceGroupId ?? board?.resourceGroups[0]?.id ?? "",
        weightClasses: entry?.weightClasses ?? ["NOT_CAPTURED"],
      };
      setEditorId(nextDraft.editorId);
      setName(nextDraft.name);
      setCodeState(nextDraft.code);
      setDescription(nextDraft.description);
      setResourceGroupId(nextDraft.resourceGroupId);
      setGateId(nextDraft.gateId);
      setPriceInput(nextDraft.priceInput);
      setReferenceDuration(nextDraft.referenceDuration);
      setPromisedFlightMinutes(nextDraft.promisedFlightMinutes);
      setBoardingOverride(nextDraft.boardingOverride);
      setDeboardingOverride(nextDraft.deboardingOverride);
      setBufferOverride(nextDraft.bufferOverride);
      setChildCompanion(nextDraft.childCompanion);
      setWeightClasses(nextDraft.weightClasses);
      return snapshotForProduct(nextDraft);
    },
    [board],
  );

  const setCode = useCallback((value: string) => {
    setCodeState(value.toUpperCase());
  }, []);

  const normalizePrice = useCallback(() => {
    const cents = parseEuroToCents(priceInput);
    if (cents !== null) setPriceInput(formatEuroInput(cents));
  }, [priceInput]);

  return {
    ...draft,
    normalizePrice,
    priceCents,
    select,
    setBoardingOverride,
    setBufferOverride,
    setChildCompanion,
    setCode,
    setDeboardingOverride,
    setDescription,
    setGateId,
    setName,
    setPriceInput,
    setPromisedFlightMinutes,
    setReferenceDuration,
    setResourceGroupId,
    setWeightClasses,
    snapshot,
  };
}
