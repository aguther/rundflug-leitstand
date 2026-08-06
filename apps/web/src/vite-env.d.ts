/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly SOURCE_REVISION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
