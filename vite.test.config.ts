// Dev server for tests on the shared build server: no file watching and no HMR
// (inotify instances there are shared with other apps and run out).
import base from "./vite.config";

export default {
  ...base,
  server: { ...base.server, watch: null, hmr: false },
};
