export interface WebAssetMetrics {
  rawBytes: number;
  gzipBytes?: number;
}

export interface ViteManifestEntry {
  file?: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export function collectManifestFiles(
  manifest: Record<string, ViteManifestEntry>,
  entryKeys: string[],
): string[];

export function verifyWebAssetReport(
  report: {
    assets: Record<string, WebAssetMetrics>;
    routes: Record<string, WebAssetMetrics>;
  },
  baseline: { routes: Record<string, WebAssetMetrics> },
  budgets?: Record<string, WebAssetMetrics>,
): string[];
