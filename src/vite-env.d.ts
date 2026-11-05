/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** "1" builds in the test hooks (window.__ns). */
  readonly VITE_TEST_HOOKS?: string;
  /** "1" builds in the demo video helpers (window.__nsVideo, solid hands). Never for production. */
  readonly VITE_VIDEO?: string;
}
