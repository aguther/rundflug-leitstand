import {
  type MasterDataTemplate,
  type MasterDataTemplateValidation,
  masterDataTemplateSchema,
  type OperationBoard,
} from "@rundflug/contracts";
import { useState } from "react";
import { importMasterDataTemplate, validateMasterDataTemplate } from "../../../api";
import { ADMIN_DEVICE_ID, deviceTokenFor, EVENT_ID } from "../../../operation-workspace";

interface UseMasterDataTemplateImportOptions {
  board: OperationBoard | null;
  onMessage: (message: string) => void;
  onRefreshBoard: () => Promise<unknown>;
  onRefreshEvents: () => Promise<unknown>;
  onRefreshHistory: () => Promise<unknown>;
}

export function useMasterDataTemplateImport({
  board,
  onMessage,
  onRefreshBoard,
  onRefreshEvents,
  onRefreshHistory,
}: UseMasterDataTemplateImportOptions) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [draft, setDraft] = useState<MasterDataTemplate | null>(null);
  const [validation, setValidation] = useState<MasterDataTemplateValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openDialog() {
    setDraft(null);
    setValidation(null);
    setError(null);
    setFileName("");
    setOpen(true);
  }

  async function readFile(file: File | null) {
    setDraft(null);
    setValidation(null);
    setError(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 1_048_576) {
      setError("Die Vorlagendatei darf höchstens 1 MiB groß sein.");
      return;
    }
    setBusy(true);
    try {
      const parsedJson = JSON.parse(await file.text()) as unknown;
      const parsedTemplate = masterDataTemplateSchema.safeParse(parsedJson);
      if (!parsedTemplate.success) {
        throw new Error(parsedTemplate.error.issues[0]?.message ?? "Ungültige Vorlage.");
      }
      setDraft(parsedTemplate.data);
      setValidation(
        await validateMasterDataTemplate(
          EVENT_ID,
          ADMIN_DEVICE_ID,
          deviceTokenFor(ADMIN_DEVICE_ID),
          parsedTemplate.data,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Die Vorlagendatei konnte nicht gelesen werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate() {
    if (!board || !draft || !validation?.valid || !validation.targetEligible) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importMasterDataTemplate(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        {
          commandId: crypto.randomUUID(),
          expectedVersion: board.event.version,
          template: draft,
        },
      );
      setOpen(false);
      onMessage(
        `Stammdatenvorlage importiert: ${result.counts.gates} Gates, ${result.counts.resourceGroups} Ressourcengruppen, ${result.counts.aircraft} Flugzeuge, ${result.counts.pilots} Pilotencodes und ${result.counts.products} Produkte.`,
      );
      await Promise.all([onRefreshBoard(), onRefreshEvents(), onRefreshHistory()]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Stammdatenvorlage konnte nicht importiert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    applyTemplate,
    busy,
    closeDialog: () => setOpen(false),
    draft,
    error,
    fileName,
    open,
    openDialog,
    readFile,
    validation,
  };
}
