import { z } from "zod";

export const masterDataTemplateKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/);

export const masterDataTemplateSourceSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const productWeightClassSchema = z.enum([
  "NOT_CAPTURED",
  "CHILD",
  "NORMAL",
  "HEAVY",
  "INDIVIDUAL",
]);

export const turnaroundPhaseOverrideValueSchema = z.number().int().min(0).max(120).nullable();

export function addDuplicateIssues(
  context: z.core.$RefinementCtx<unknown>,
  values: readonly string[],
  path: string,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `${label} ist doppelt vorhanden.`,
        path: [path, index],
      });
    }
    seen.add(value);
  });
}
