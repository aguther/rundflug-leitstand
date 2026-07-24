import { useEffect } from "react";

export type PublicStatusTarget = "ticket" | "group";

export function usePublicStatusManifest(target: PublicStatusTarget, code: string): void {
  useEffect(() => {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const link = existing ?? document.createElement("link");
    const previousHref = existing?.getAttribute("href") ?? null;
    link.rel = "manifest";
    link.href = `/api/public/pwa-manifest/${target}/${encodeURIComponent(code)}`;
    link.dataset.publicStatusManifest = target;
    if (!existing) document.head.append(link);

    return () => {
      if (!existing) {
        link.remove();
        return;
      }
      delete link.dataset.publicStatusManifest;
      if (previousHref === null) link.removeAttribute("href");
      else link.setAttribute("href", previousHref);
    };
  }, [code, target]);
}
