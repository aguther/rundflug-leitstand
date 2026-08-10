import { z } from "zod";

export const appEnvironmentSchema = z.enum(["development", "acceptance", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const timeZoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Ungültige IANA-Zeitzone" },
  );

export const gateDisplayFilterSchema = z
  .object({
    productIds: z
      .array(z.string().min(1).max(100))
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Produktfilter enthält Duplikate",
      ),
    rotationStatuses: z
      .array(z.enum(["DRAFT", "CALLED", "IN_FLIGHT", "LANDED", "COMPLETED"]))
      .max(5)
      .refine((values) => new Set(values).size === values.length, "Statusfilter enthält Duplikate"),
  })
  .strict();
export type GateDisplayFilter = z.infer<typeof gateDisplayFilterSchema>;
