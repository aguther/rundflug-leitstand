import type { MasterDataCategory } from "../../../admin-ux";

export function masterEditorForCategory<T>(
  category: MasterDataCategory,
  editors: {
    aircraft: T;
    gates: T;
    pilots: T;
    products: T;
    resourceGroups: T;
  },
): T {
  if (category === "gates") return editors.gates;
  if (category === "products") return editors.products;
  if (category === "resource-groups") return editors.resourceGroups;
  if (category === "pilots") return editors.pilots;
  return editors.aircraft;
}
