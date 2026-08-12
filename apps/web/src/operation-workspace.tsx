// Compatibility facade for shared operational UI contracts. New feature code should import the
// focused module directly so changes do not fan out through a broad implementation module.
export * from "./features/operations/operation-field-primitives";
export * from "./features/operations/operation-identity";
export * from "./features/operations/operation-labels";
export * from "./features/operations/operation-notices";
export * from "./features/operations/operation-types";
export * from "./features/operations/use-operation-board";

export const MASTER_DATA_AUDIT_REASON = "Administrative Stammdatenpflege";
export const OPERATIONAL_AUDIT_REASON = "Operative Änderung über Administration";
export const ADMIN_CONFIGURATION_AUDIT_REASON = "Administrative Konfigurationspflege";
export const MASTER_DATA_DELETE_REASON = "Administrative Stammdatenlöschung";
