interface ProductValidationFields {
  code: string;
  gateId: string;
  name: string;
  resourceGroupId: string;
}

interface ResourceGroupValidationFields {
  gateId: string;
  name: string;
  shortCode: string;
}

interface AircraftValidationFields {
  registration: string;
  type: string;
}

export function invalidProductField(editor: ProductValidationFields, priceCents: number | null) {
  if (editor.name.trim().length < 2) return "product-name";
  if (!/^[A-Z0-9-]{2,12}$/.test(editor.code)) return "product-code";
  if (priceCents === null) return "product-price";
  if (!editor.resourceGroupId) return "product-resource-group";
  if (!editor.gateId) return "product-gate";
  return null;
}

export function invalidResourceGroupField(editor: ResourceGroupValidationFields) {
  if (editor.name.trim().length < 2) return "resource-name";
  if (!/^[A-Z0-9-]{2,8}$/.test(editor.shortCode.trim().toUpperCase())) {
    return "resource-short-code";
  }
  if (!editor.gateId) return "resource-gate";
  return undefined;
}

export function invalidAircraftField(editor: AircraftValidationFields) {
  if (editor.registration.trim().length < 3) return "aircraft-registration";
  if (editor.type.trim().length < 2) return "aircraft-type";
  return undefined;
}
