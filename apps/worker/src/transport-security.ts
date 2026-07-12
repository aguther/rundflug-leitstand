export function httpsRedirectLocation(requestUrl: string, environment: string): string | null {
  const url = new URL(requestUrl);
  if (environment === "development" || url.protocol === "https:") return null;
  url.protocol = "https:";
  return url.toString();
}
