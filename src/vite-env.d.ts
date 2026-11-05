/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** "1" builds in the test hooks (window.__ns, window.__sl). */
  readonly VITE_TEST_HOOKS?: string;
  /** "1" builds in the demo video helpers (window.__nsVideo, the see-through system hand). Never for production. */
  readonly VITE_VIDEO?: string;
}
