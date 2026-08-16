import { z } from "zod";
import contractJson from "./portable-backup-table-contract.json";

const tableNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const portableBackupTableContractSchema = z
  .object({
    format: z.literal("rundflug-portable-backup-table-contract"),
    version: z.literal(1),
    tables: z.array(tableNameSchema).min(1),
    excludedTables: z.array(tableNameSchema),
  })
  .superRefine((contract, context) => {
    if (new Set(contract.tables).size !== contract.tables.length) {
      context.addIssue({ code: "custom", message: "Portable backup table names must be unique." });
    }
    const overlap = contract.tables.filter((table) => contract.excludedTables.includes(table));
    if (overlap.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Included and excluded backup tables overlap: ${overlap.join(", ")}`,
      });
    }
  });

export const PORTABLE_BACKUP_TABLE_CONTRACT = portableBackupTableContractSchema.parse(contractJson);
export const BACKUP_TABLES = PORTABLE_BACKUP_TABLE_CONTRACT.tables;
export type PortableBackupTable = (typeof BACKUP_TABLES)[number];
