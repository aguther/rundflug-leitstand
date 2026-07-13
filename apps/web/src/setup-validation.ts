export interface SetupFormValues {
  eventId: string;
  name: string;
  eventDate: string;
  aerodrome: string;
  setupCode: string;
  adminPin: string;
}

export function setupValidationMessages(values: SetupFormValues): string[] {
  const messages: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(values.eventId.trim())) {
    messages.push(
      "Die technische Veranstaltungs-ID benötigt 3–64 Kleinbuchstaben, Ziffern oder Bindestriche.",
    );
  }
  if (values.name.trim().length < 3 || values.name.trim().length > 120) {
    messages.push("Die Bezeichnung benötigt 3–120 Zeichen.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.eventDate)) {
    messages.push("Bitte ein Veranstaltungsdatum auswählen.");
  }
  if (values.aerodrome.trim().length < 2 || values.aerodrome.trim().length > 120) {
    messages.push("Der Flugplatz benötigt 2–120 Zeichen.");
  }
  if (values.setupCode.length < 16 || values.setupCode.length > 256) {
    messages.push("Der einmalige Einrichtungscode benötigt 16–256 Zeichen.");
  }
  if (values.adminPin.length < 4 || values.adminPin.length > 32) {
    messages.push("Die Administrator-PIN benötigt 4–32 Zeichen.");
  }
  return messages;
}
