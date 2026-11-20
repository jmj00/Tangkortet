/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATAFORDELER_API_KEY?: string;
  /** Base URL for the published data payload. Defaults to "/data" (web/public/data in dev). */
  readonly VITE_DATA_BASE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
