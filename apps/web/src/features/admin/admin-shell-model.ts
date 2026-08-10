import type { OperationBoard } from "@rundflug/contracts";
import type { AdminArea, AdminEventStep, SetupStep } from "../../admin-ux";

type AdminPageCopy = { title: string; description: string };

export const adminEventStepCopy: Record<AdminEventStep, AdminPageCopy> = {
  event: {
    title: "Veranstaltung",
    description: "Grunddaten, Betriebszeiten und öffentliche Darstellung verwalten.",
  },
  gates: {
    title: "Gates",
    description: "Ausgabeorte, Reihenfolge und Displayfilter verwalten.",
  },
  "resource-groups": {
    title: "Ressourcengruppen",
    description: "Operative Queues, Kapazitäten und Flugzeugzuordnungen verwalten.",
  },
  aircraft: {
    title: "Flugzeuge",
    description: "Flotte, Sitzplätze und organisatorische Zuordnungen verwalten.",
  },
  pilots: {
    title: "Pilotencodes",
    description: "Anonyme operative Codes und Verfügbarkeit verwalten.",
  },
  products: {
    title: "Produkte",
    description: "Verkaufsprodukte, Preise und Queue-Zuordnung verwalten.",
  },
  "operational-plan": {
    title: "Betriebsplan",
    description: "Einschränkungen und wiederkehrende Regeln für den Flugtag planen.",
  },
  operations: {
    title: "Betrieb",
    description: "Betriebsfreigabe, Betriebsende und Notfallmodus verwalten.",
  },
  completion: {
    title: "Abschluss",
    description: "Betriebstag prüfen, Berichte exportieren und Verläufe auswerten.",
  },
};

export const adminAreaCopy: Record<AdminArea, AdminPageCopy> = {
  overview: {
    title: "Übersicht",
    description: "Betriebsstatus, Kennzahlen und offene organisatorische Aufgaben.",
  },
  events: {
    title: "Veranstaltungen",
    description: "Veranstaltung auswählen, vorbereiten, betreiben und abschließen.",
  },
  users: {
    title: "Konten",
    description: "Pseudonyme Arbeitskonten, Rollen und Sitzungen verwalten.",
  },
  evaluation: {
    title: "Auswertung",
    description: "Synthetische Prognoseszenarien im Simulator untersuchen.",
  },
  backup: {
    title: "Sicherung & Reset",
    description: "Daten gezielt bereinigen oder das System vollständig neu einrichten.",
  },
};

export function createAdminSetupSteps(board: OperationBoard | null): SetupStep[] {
  return [
    {
      id: "event",
      label: "Veranstaltung",
      complete: Boolean(
        board &&
          (board.event.status !== "PREPARATION" ||
            (board.event.saleOpensAt && board.event.operationsEndAt)),
      ),
    },
    {
      id: "gates",
      label: "Gates",
      complete: Boolean(board?.gates.some((gate) => gate.active)),
      category: "gates",
    },
    {
      id: "resource-groups",
      label: "Ressourcengruppen",
      complete: Boolean(
        board?.resourceGroups.length &&
          board.resourceGroups.every((group) => group.activeAircraftIds.length > 0),
      ),
      category: "resource-groups",
    },
    {
      id: "aircraft",
      label: "Flugzeuge",
      complete: Boolean(board?.aircraft.length),
      category: "aircraft",
    },
    {
      id: "pilots",
      label: "Pilotencodes",
      complete: Boolean(board?.pilots.some((pilot) => pilot.active)),
      category: "pilots",
    },
    {
      id: "products",
      label: "Produkte",
      complete: Boolean(board?.products.length),
      category: "products",
    },
    {
      id: "operational-plan",
      label: "Betriebsplan",
      complete: Boolean(
        board?.plannedOperations.length ||
          board?.recurringOperationalRules.some((rule) => rule.status === "ACTIVE"),
      ),
    },
    {
      id: "operations",
      label: "Betrieb",
      complete: board?.event.status === "CLOSED" || board?.event.status === "ARCHIVED",
    },
    {
      id: "completion",
      label: "Abschluss",
      complete: board?.event.status === "ARCHIVED",
    },
  ];
}

export function summarizeAdminSetup(steps: SetupStep[]) {
  const requiredSteps = steps.slice(0, 6);
  return {
    complete: requiredSteps.every((step) => step.complete),
    completedSteps: requiredSteps.filter((step) => step.complete).length,
  };
}
