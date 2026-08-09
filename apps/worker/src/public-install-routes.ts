import { formatBookingGroupLabel } from "@rundflug/domain";
import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";

type PublicStatusInstallTarget = "ticket" | "group";

export interface AppInstallProfile {
  manifestHref: string;
  faviconHref: string;
  appleTouchIconHref: string;
  title: string;
}

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

export const PUBLIC_STATUS_CODE_PATTERN = /^[A-Z2-9]{12,32}$/;

export const INTERNAL_APP_INSTALL_PROFILES = {
  "/kasse": {
    manifestHref: "/manifests/kasse.webmanifest",
    faviconHref: "/icons/pwa/kasse/favicon.svg",
    appleTouchIconHref: "/icons/pwa/kasse/apple-touch-icon-180.png",
    title: "Kasse · Rundflug-Leitstand",
  },
  "/flight-director": {
    manifestHref: "/manifests/flight-director.webmanifest",
    faviconHref: "/icons/pwa/flight-director/favicon.svg",
    appleTouchIconHref: "/icons/pwa/flight-director/apple-touch-icon-180.png",
    title: "Flight Director · Rundflug-Leitstand",
  },
  "/flight-line": {
    manifestHref: "/manifests/flight-line.webmanifest",
    faviconHref: "/icons/pwa/flight-line/favicon.svg",
    appleTouchIconHref: "/icons/pwa/flight-line/apple-touch-icon-180.png",
    title: "Flight Line · Rundflug-Leitstand",
  },
  "/fids": {
    manifestHref: "/manifests/fids.webmanifest",
    faviconHref: "/icons/pwa/fids/favicon.svg",
    appleTouchIconHref: "/icons/pwa/fids/apple-touch-icon-180.png",
    title: "FIDS · Rundflug-Leitstand",
  },
  "/fids/terminal": {
    manifestHref: "/manifests/fids.webmanifest",
    faviconHref: "/icons/pwa/fids/favicon.svg",
    appleTouchIconHref: "/icons/pwa/fids/apple-touch-icon-180.png",
    title: "FIDS · Rundflug-Leitstand",
  },
  "/admin": {
    manifestHref: "/manifests/admin.webmanifest",
    faviconHref: "/icons/pwa/admin/favicon.svg",
    appleTouchIconHref: "/icons/pwa/admin/apple-touch-icon-180.png",
    title: "Admin · Rundflug-Leitstand",
  },
} satisfies Record<string, AppInstallProfile>;

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function publicStatusInstallTitle(
  db: D1Database,
  target: PublicStatusInstallTarget,
  code: string,
): Promise<string> {
  const codeHash = await sha256Hex(code);
  const row =
    target === "ticket"
      ? await db
          .prepare(
            `SELECT p.code AS product_code, tg.communication_number
               FROM tickets t
               JOIN ticket_groups tg ON tg.id = t.ticket_group_id
               JOIN products p ON p.id = tg.product_id
              WHERE t.public_code_hash = ?1 AND tg.status <> 'CANCELED'
              LIMIT 1`,
          )
          .bind(codeHash)
          .first<{ product_code: string; communication_number: number }>()
      : await db
          .prepare(
            `SELECT p.code AS product_code, tg.communication_number
               FROM ticket_groups tg
               JOIN products p ON p.id = tg.product_id
              WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'
              LIMIT 1`,
          )
          .bind(codeHash)
          .first<{ product_code: string; communication_number: number }>();
  return row
    ? formatBookingGroupLabel(row.product_code, row.communication_number)
    : target === "group"
      ? "Gruppenstatus"
      : "Ticketstatus";
}

async function installableAppShellResponse(
  env: Env,
  request: Request,
  profile: AppInstallProfile,
): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.headers.get("content-type")?.includes("text/html")) return assetResponse;

  const headers = new Headers(assetResponse.headers);
  headers.set("cache-control", "private, no-store");
  const htmlResponse = new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
  const appleTitle = profile.title.split(" · ", 1)[0] ?? profile.title;
  const headMetadata = [
    `<link rel="manifest" href="${escapeHtmlAttribute(profile.manifestHref)}">`,
    `<link rel="icon" href="${escapeHtmlAttribute(profile.faviconHref)}" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${escapeHtmlAttribute(profile.appleTouchIconHref)}">`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtmlAttribute(appleTitle)}">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
  ].join("");
  return new HTMLRewriter()
    .on('link[rel="manifest"]', {
      element(element) {
        element.remove();
      },
    })
    .on('link[rel="icon"]', {
      element(element) {
        element.remove();
      },
    })
    .on('link[rel="apple-touch-icon"]', {
      element(element) {
        element.remove();
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(element) {
        element.remove();
      },
    })
    .on('meta[name="apple-mobile-web-app-capable"]', {
      element(element) {
        element.remove();
      },
    })
    .on("title", {
      element(element) {
        element.setInnerContent(profile.title);
      },
    })
    .on("head", {
      element(element) {
        element.append(headMetadata, { html: true });
      },
    })
    .transform(htmlResponse);
}

export function registerPublicInstallRoutes(app: WorkerApp): void {
  app.get("/api/public/pwa-manifest/:target/:code", async (context) => {
    const target = context.req.param("target").trim().toLowerCase();
    const code = context.req.param("code").trim().toUpperCase();
    if ((target !== "ticket" && target !== "group") || !PUBLIC_STATUS_CODE_PATTERN.test(code)) {
      return context.json(
        { error: { code: "PUBLIC_TARGET_NOT_FOUND", message: "Statusseite nicht gefunden." } },
        404,
      );
    }
    const targetPath = target === "group" ? `/gruppe/${code}` : `/ticket/${code}`;
    const installTitle = await publicStatusInstallTitle(context.env.DB, target, code);
    return new Response(
      JSON.stringify({
        id: targetPath,
        start_url: targetPath,
        scope: "/",
        name: installTitle,
        short_name: installTitle,
        description: "Aktueller öffentlicher Rundflug-Status",
        lang: "de",
        display: "standalone",
        background_color: "#f4f7fb",
        theme_color: "#ffffff",
        icons: [
          {
            src: "/icons/pwa/ticket/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pwa/ticket/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pwa/ticket/maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/pwa/ticket/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      }),
      {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/manifest+json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  });

  for (const [path, profile] of Object.entries(INTERNAL_APP_INSTALL_PROFILES)) {
    app.get(path, (context) => installableAppShellResponse(context.env, context.req.raw, profile));
  }

  for (const target of ["ticket", "group"] as const) {
    const route = target === "group" ? "/gruppe/:code" : "/ticket/:code";
    app.get(route, async (context) => {
      const code = context.req.param("code").trim().toUpperCase();
      if (!PUBLIC_STATUS_CODE_PATTERN.test(code)) {
        return context.env.ASSETS.fetch(context.req.raw);
      }
      const installTitle = await publicStatusInstallTitle(context.env.DB, target, code);
      return installableAppShellResponse(context.env, context.req.raw, {
        manifestHref: `/api/public/pwa-manifest/${target}/${code}`,
        faviconHref: "/icons/pwa/ticket/favicon.svg",
        appleTouchIconHref: "/icons/pwa/ticket/apple-touch-icon-180.png",
        title: `${installTitle} · Rundflug`,
      });
    });
  }
}
