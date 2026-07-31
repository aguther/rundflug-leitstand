import type { EventSnapshot } from "@rundflug/contracts";
import { useEffect, useMemo, useReducer } from "react";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "../../../event-time";

export type EventParameterFormValues = {
  saleOpensAt: string;
  operationsStartAt: string;
  operationsEndAt: string;
  noShowAfterMinutes: string;
  maxTicketDeferrals: string;
  notificationLeadMinutes: string;
  automaticPrecallEnabled: boolean;
  precallLeadMinutes: string;
  maximumGateWaitMinutes: string;
  precallMinimumQuality: "STABLE" | "CHANGING";
  precallGateCooldownMinutes: string;
  childReferenceWeightKg: string;
  normalReferenceWeightKg: string;
  heavyReferenceWeightKg: string;
  plannedBoardingMinutes: string;
  plannedDeboardingMinutes: string;
  plannedBufferMinutes: string;
  departedVisibilitySeconds: string;
};

export type EventParameterField = keyof EventParameterFormValues;
export type EventParameterErrors = Partial<Record<EventParameterField, string>>;

export type ValidEventParameterPayload = {
  saleOpensAt: string | null;
  operationsStartAt: string | null;
  operationsEndAt: string;
  noShowAfterMinutes: number;
  maxTicketDeferrals: number;
  notificationLeadMinutes: number;
  automaticPrecallEnabled: boolean;
  precallLeadMinutes: number;
  maximumGateWaitMinutes: number;
  precallMinimumQuality: "STABLE" | "CHANGING";
  precallGateCooldownMinutes: number;
  childReferenceWeightKg: number;
  normalReferenceWeightKg: number;
  heavyReferenceWeightKg: number;
  plannedBoardingMinutes: number;
  plannedDeboardingMinutes: number;
  plannedBufferMinutes: number;
  departedVisibilitySeconds: number;
};

export type EventParameterValidation = {
  errors: EventParameterErrors;
  payload: ValidEventParameterPayload | null;
};

export function mapEventParameters(event: EventSnapshot): EventParameterFormValues {
  return {
    saleOpensAt: formatEventLocalDateTime(event.saleOpensAt, event.timeZone),
    operationsStartAt: formatEventLocalDateTime(event.operationsStartAt, event.timeZone),
    operationsEndAt: formatEventLocalDateTime(event.operationsEndAt, event.timeZone),
    noShowAfterMinutes: String(event.noShowAfterMinutes),
    maxTicketDeferrals: String(event.maxTicketDeferrals),
    notificationLeadMinutes: String(event.notificationLeadMinutes),
    automaticPrecallEnabled: event.automaticPrecallEnabled,
    precallLeadMinutes: String(event.precallLeadMinutes),
    maximumGateWaitMinutes: String(event.maximumGateWaitMinutes),
    precallMinimumQuality: event.precallMinimumQuality,
    precallGateCooldownMinutes: String(event.precallGateCooldownMinutes),
    childReferenceWeightKg: String(event.referenceWeightsKg.child),
    normalReferenceWeightKg: String(event.referenceWeightsKg.normal),
    heavyReferenceWeightKg: String(event.referenceWeightsKg.heavy),
    plannedBoardingMinutes: String(event.plannedBoardingMinutes),
    plannedDeboardingMinutes: String(event.plannedDeboardingMinutes),
    plannedBufferMinutes: String(event.plannedBufferMinutes),
    departedVisibilitySeconds: String(event.departedVisibilitySeconds),
  };
}

function parseNumberField(
  values: EventParameterFormValues,
  field: EventParameterField,
  label: string,
  minimum: number,
  maximum: number,
  errors: EventParameterErrors,
  integer: boolean,
): number | null {
  const raw = values[field];
  if (typeof raw !== "string" || raw.trim() === "") {
    errors[field] = `${label} ist erforderlich.`;
    return null;
  }
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    errors[field] = `${label} muss ${integer ? "eine ganze" : "eine"} Zahl sein.`;
    return null;
  }
  if (parsed < minimum || parsed > maximum) {
    errors[field] = `${label} muss zwischen ${minimum} und ${maximum} liegen.`;
    return null;
  }
  return parsed;
}

function parseDateTimeField(
  value: string,
  timeZone: string,
  field: "saleOpensAt" | "operationsStartAt" | "operationsEndAt",
  label: string,
  errors: EventParameterErrors,
  required: boolean,
): string | null {
  if (!value) {
    if (required) errors[field] = `${label} ist erforderlich.`;
    return null;
  }
  try {
    return eventLocalDateTimeToIso(value, timeZone);
  } catch (cause) {
    errors[field] = cause instanceof Error ? cause.message : `${label} ist ungültig.`;
    return null;
  }
}

export function validateEventParameters(
  values: EventParameterFormValues,
  timeZone: string,
): EventParameterValidation {
  const errors: EventParameterErrors = {};
  const saleOpensAt = parseDateTimeField(
    values.saleOpensAt,
    timeZone,
    "saleOpensAt",
    "Verkaufsbeginn",
    errors,
    false,
  );
  const operationsStartAt = parseDateTimeField(
    values.operationsStartAt,
    timeZone,
    "operationsStartAt",
    "Betriebsbeginn",
    errors,
    false,
  );
  const operationsEndAt = parseDateTimeField(
    values.operationsEndAt,
    timeZone,
    "operationsEndAt",
    "Betriebsende",
    errors,
    true,
  );
  if (saleOpensAt && operationsEndAt && Date.parse(saleOpensAt) >= Date.parse(operationsEndAt)) {
    errors.saleOpensAt = "Der Verkaufsbeginn muss vor dem Betriebsende liegen.";
  }
  if (
    operationsStartAt &&
    operationsEndAt &&
    Date.parse(operationsStartAt) >= Date.parse(operationsEndAt)
  ) {
    errors.operationsStartAt = "Der Betriebsbeginn muss vor dem Betriebsende liegen.";
  }

  const noShowAfterMinutes = parseNumberField(
    values,
    "noShowAfterMinutes",
    "No-Show-Zeit",
    1,
    120,
    errors,
    true,
  );
  const maxTicketDeferrals = parseNumberField(
    values,
    "maxTicketDeferrals",
    "Zurückstellungen",
    1,
    10,
    errors,
    true,
  );
  const notificationLeadMinutes = parseNumberField(
    values,
    "notificationLeadMinutes",
    "Benachrichtigungsvorlauf",
    1,
    240,
    errors,
    true,
  );
  const precallLeadMinutes = parseNumberField(
    values,
    "precallLeadMinutes",
    "Voraufruf-Vorlauf",
    1,
    240,
    errors,
    true,
  );
  const maximumGateWaitMinutes = parseNumberField(
    values,
    "maximumGateWaitMinutes",
    "Maximale Gate-Wartezeit",
    1,
    120,
    errors,
    true,
  );
  const precallGateCooldownMinutes = parseNumberField(
    values,
    "precallGateCooldownMinutes",
    "Gate-Sperrzeit",
    0,
    60,
    errors,
    true,
  );
  const childReferenceWeightKg = parseNumberField(
    values,
    "childReferenceWeightKg",
    "Referenzgewicht Kind",
    0.01,
    300,
    errors,
    false,
  );
  const normalReferenceWeightKg = parseNumberField(
    values,
    "normalReferenceWeightKg",
    "Referenzgewicht Standard",
    0.01,
    300,
    errors,
    false,
  );
  const heavyReferenceWeightKg = parseNumberField(
    values,
    "heavyReferenceWeightKg",
    "Referenzgewicht Erhöht",
    0.01,
    300,
    errors,
    false,
  );
  if (
    childReferenceWeightKg !== null &&
    normalReferenceWeightKg !== null &&
    childReferenceWeightKg >= normalReferenceWeightKg
  ) {
    errors.childReferenceWeightKg =
      "Das Kindergewicht muss unter dem Standardgewicht liegen.";
  }
  if (
    normalReferenceWeightKg !== null &&
    heavyReferenceWeightKg !== null &&
    normalReferenceWeightKg >= heavyReferenceWeightKg
  ) {
    errors.normalReferenceWeightKg =
      "Das Standardgewicht muss unter dem erhöhten Gewicht liegen.";
  }
  const plannedBoardingMinutes = parseNumberField(
    values,
    "plannedBoardingMinutes",
    "Boarding",
    1,
    120,
    errors,
    true,
  );
  const plannedDeboardingMinutes = parseNumberField(
    values,
    "plannedDeboardingMinutes",
    "Ausstieg",
    1,
    120,
    errors,
    true,
  );
  const plannedBufferMinutes = parseNumberField(
    values,
    "plannedBufferMinutes",
    "Puffer",
    0,
    120,
    errors,
    true,
  );
  const departedVisibilitySeconds = parseNumberField(
    values,
    "departedVisibilitySeconds",
    "Sichtbarkeit abgeflogener Zeilen",
    5,
    900,
    errors,
    true,
  );

  const numericValues = [
    noShowAfterMinutes,
    maxTicketDeferrals,
    notificationLeadMinutes,
    precallLeadMinutes,
    maximumGateWaitMinutes,
    precallGateCooldownMinutes,
    childReferenceWeightKg,
    normalReferenceWeightKg,
    heavyReferenceWeightKg,
    plannedBoardingMinutes,
    plannedDeboardingMinutes,
    plannedBufferMinutes,
    departedVisibilitySeconds,
  ];
  if (Object.keys(errors).length > 0 || operationsEndAt === null || numericValues.includes(null)) {
    return { errors, payload: null };
  }

  return {
    errors,
    payload: {
      saleOpensAt,
      operationsStartAt,
      operationsEndAt,
      noShowAfterMinutes: noShowAfterMinutes as number,
      maxTicketDeferrals: maxTicketDeferrals as number,
      notificationLeadMinutes: notificationLeadMinutes as number,
      automaticPrecallEnabled: values.automaticPrecallEnabled,
      precallLeadMinutes: precallLeadMinutes as number,
      maximumGateWaitMinutes: maximumGateWaitMinutes as number,
      precallMinimumQuality: values.precallMinimumQuality,
      precallGateCooldownMinutes: precallGateCooldownMinutes as number,
      childReferenceWeightKg: childReferenceWeightKg as number,
      normalReferenceWeightKg: normalReferenceWeightKg as number,
      heavyReferenceWeightKg: heavyReferenceWeightKg as number,
      plannedBoardingMinutes: plannedBoardingMinutes as number,
      plannedDeboardingMinutes: plannedDeboardingMinutes as number,
      plannedBufferMinutes: plannedBufferMinutes as number,
      departedVisibilitySeconds: departedVisibilitySeconds as number,
    },
  };
}

type FormState = {
  eventId: string;
  cleanVersion: number;
  cleanValues: EventParameterFormValues;
  values: EventParameterFormValues;
  conflictVersion: number | null;
};

type FormAction =
  | { type: "SYNC"; event: EventSnapshot }
  | { type: "SET"; field: EventParameterField; value: string | boolean }
  | { type: "DISCARD"; event: EventSnapshot }
  | { type: "MARK_SAVED" }
  | { type: "CONFLICT"; currentVersion?: number };

function valuesEqual(
  left: EventParameterFormValues,
  right: EventParameterFormValues,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function initialState(event: EventSnapshot): FormState {
  const values = mapEventParameters(event);
  return {
    eventId: event.eventId,
    cleanVersion: event.version,
    cleanValues: values,
    values,
    conflictVersion: null,
  };
}

function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "SET") {
    return { ...state, values: { ...state.values, [action.field]: action.value } };
  }
  if (action.type === "MARK_SAVED") {
    return {
      ...state,
      cleanValues: state.values,
      conflictVersion: null,
    };
  }
  if (action.type === "CONFLICT") {
    return {
      ...state,
      conflictVersion: action.currentVersion ?? state.cleanVersion + 1,
    };
  }
  const nextValues = mapEventParameters(action.event);
  if (action.type === "DISCARD" || action.event.eventId !== state.eventId) {
    return initialState(action.event);
  }
  const dirty = !valuesEqual(state.values, state.cleanValues);
  if (!dirty) {
    return {
      eventId: action.event.eventId,
      cleanVersion: action.event.version,
      cleanValues: nextValues,
      values: nextValues,
      conflictVersion: null,
    };
  }
  if (action.event.version !== state.cleanVersion) {
    return {
      ...state,
      conflictVersion: action.event.version,
    };
  }
  return state;
}

export function useEventParametersForm(event: EventSnapshot) {
  const [state, dispatch] = useReducer(formReducer, event, initialState);
  useEffect(() => dispatch({ type: "SYNC", event }), [event]);
  const dirty = !valuesEqual(state.values, state.cleanValues);
  const validation = useMemo(
    () => validateEventParameters(state.values, event.timeZone),
    [event.timeZone, state.values],
  );

  return {
    values: state.values,
    dirty,
    validation,
    conflictVersion: state.conflictVersion,
    setValue(field: EventParameterField, value: string | boolean) {
      dispatch({ type: "SET", field, value });
    },
    discard() {
      dispatch({ type: "DISCARD", event });
    },
    markSaved() {
      dispatch({ type: "MARK_SAVED" });
    },
    markConflict(currentVersion?: number) {
      dispatch(
        currentVersion === undefined
          ? { type: "CONFLICT" }
          : { type: "CONFLICT", currentVersion },
      );
    },
  };
}
