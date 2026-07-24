export type PublicStatusTarget = "ticket" | "group";

interface InstallMetadata {
  manifestHref: string;
  appleTouchIconHref: string;
  documentTitle: string;
  appleTitle: string;
}

const INTERNAL_INSTALL_METADATA: Record<string, InstallMetadata> = {
  "/kasse": {
    manifestHref: "/manifests/kasse.webmanifest",
    appleTouchIconHref: "/icons/kasse-icon-180.png",
    documentTitle: "Kasse · Rundflug-Leitstand",
    appleTitle: "Kasse",
  },
  "/flight-director": {
    manifestHref: "/manifests/flight-director.webmanifest",
    appleTouchIconHref: "/icons/flight-line-icon-180.png",
    documentTitle: "Flight Director · Rundflug-Leitstand",
    appleTitle: "Flight Director",
  },
  "/flight-line": {
    manifestHref: "/manifests/flight-line.webmanifest",
    appleTouchIconHref: "/icons/assist-icon-180.png",
    documentTitle: "Flight Line · Rundflug-Leitstand",
    appleTitle: "Flight Line",
  },
  "/fids": {
    manifestHref: "/manifests/fids.webmanifest",
    appleTouchIconHref: "/icons/fids-icon-180.png",
    documentTitle: "FIDS · Rundflug-Leitstand",
    appleTitle: "FIDS",
  },
  "/admin": {
    manifestHref: "/manifests/admin.webmanifest",
    appleTouchIconHref: "/icons/admin-icon-180.png",
    documentTitle: "Admin · Rundflug-Leitstand",
    appleTitle: "Admin",
  },
};

function ensureLink(documentRef: Document, rel: string): HTMLLinkElement {
  const existing = documentRef.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (existing) return existing;
  const link = documentRef.createElement("link");
  link.rel = rel;
  documentRef.head.append(link);
  return link;
}

function ensureMeta(documentRef: Document, name: string): HTMLMetaElement {
  const existing = documentRef.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (existing) return existing;
  const meta = documentRef.createElement("meta");
  meta.name = name;
  documentRef.head.append(meta);
  return meta;
}

export function applyInstallMetadata(metadata: InstallMetadata, documentRef = document): void {
  ensureLink(documentRef, "manifest").href = metadata.manifestHref;
  ensureLink(documentRef, "apple-touch-icon").href = metadata.appleTouchIconHref;
  ensureMeta(documentRef, "apple-mobile-web-app-title").content = metadata.appleTitle;
  ensureMeta(documentRef, "apple-mobile-web-app-capable").content = "yes";
  documentRef.title = metadata.documentTitle;
}

export function publicStatusInstallMetadata(
  target: PublicStatusTarget,
  code: string,
  bookingGroupLabel?: string,
): InstallMetadata {
  const fallbackTitle = target === "group" ? "Gruppenstatus" : "Ticketstatus";
  const appTitle = bookingGroupLabel ?? fallbackTitle;
  return {
    manifestHref: `/api/public/pwa-manifest/${target}/${encodeURIComponent(code)}`,
    appleTouchIconHref: "/icons/ticket-icon-180.png",
    documentTitle: `${appTitle} · Rundflug`,
    appleTitle: appTitle,
  };
}

export function installMetadataForPath(pathname: string): InstallMetadata | null {
  const publicMatch = pathname.match(/^\/(ticket|gruppe)\/([A-Za-z2-9]{12,32})$/);
  const publicCode = publicMatch?.[2];
  if (publicMatch && publicCode) {
    return publicStatusInstallMetadata(
      publicMatch[1] === "gruppe" ? "group" : "ticket",
      publicCode.toUpperCase(),
    );
  }
  if (pathname === "/fids/terminal") return INTERNAL_INSTALL_METADATA["/fids"] ?? null;
  return INTERNAL_INSTALL_METADATA[pathname] ?? null;
}

export function applyInitialInstallMetadata(): void {
  const metadata = installMetadataForPath(window.location.pathname);
  if (metadata) applyInstallMetadata(metadata);
}
