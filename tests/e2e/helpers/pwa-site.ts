// A production build of the app, served the way the host serves it, for tests of the service worker
// (the dev server has none). The build keeps the test hooks and the IWER emulator: IWSDK injects the
// emulator into a build only when iwsdk.config.json says so, so the build runs from a copy of the
// app (.e2e-build/) whose config does. Output goes to dist-e2e/, never dist/.
// The copy leaves out the emulator's synthetic room: it runs its room script from a blob: URL,
// which the production CSP rightly blocks. On a headset the room is real, and without it the box
// is placed from the head pose, so the game itself runs under exactly the production headers.
import fs from "node:fs";
import path from "node:path";
import { build, preview, type PreviewServer } from "vite";
import { headersFor, parseHeadersFile } from "./pages-headers";

export const PWA_PORT = 8082;
/** Where the test server collects CSP reports (enforced mode adds `report-uri` for it). */
export const CSP_REPORT_PATH = "/__csp-report";
/** A same-origin worker that tries eval, to prove violations inside workers are reported. */
export const CSP_SELFTEST_WORKER = "/__csp-selftest-worker.js";

/** One CSP violation report (report-uri format), from a document or a worker. */
export interface CspReport {
  "document-uri": string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "blocked-uri": string;
  "source-file"?: string;
  "line-number"?: number;
}

export interface PwaSite {
  url: string;
  outDir: string;
  /** Paths the generated sw.js precaches, relative to the site root. */
  precached: string[];
  /** CSP reports received so far (enforced mode only). */
  reports(): CspReport[];
  close(): Promise<void>;
}

/** Builds the app with test hooks and the emulator into dist-e2e/ (about a minute). */
export async function buildForTests(repo = process.cwd()): Promise<string> {
  const root = path.join(repo, ".e2e-build");
  const outDir = path.join(repo, "dist-e2e");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // package.json too: src/platform/version.ts imports the build's version from it.
  for (const f of ["index.html", "src", "public", "package.json"]) fs.cpSync(path.join(repo, f), path.join(root, f), { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(repo, "iwsdk.config.json"), "utf8"));
  const { environment: _room, ...emulator } = config.dev?.emulator ?? {};
  config.dev = { ...config.dev, emulator: { ...emulator, injectOnBuild: true } };
  fs.writeFileSync(path.join(root, "iwsdk.config.json"), JSON.stringify(config, null, 2));
  process.env.VITE_TEST_HOOKS = "1";
  await build({
    configFile: path.join(repo, "vite.config.ts"),
    root,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(root, "index.html") } },
  });
  return outDir;
}

export interface ServeOptions {
  port?: number;
  /**
   * Send the CSP enforced (as production does; a report-only one is enforced too), with `report-uri`
   * pointing at this server: browsers report violations in workers there too, which no console
   * event shows.
   */
  enforceCsp?: boolean;
}

/** Serves `outDir` on localhost with the headers its `_headers` file asks for (Cloudflare Pages rules). */
export async function serve(outDir: string, o: ServeOptions = {}): Promise<PwaSite> {
  const port = o.port ?? PWA_PORT;
  const rules = parseHeadersFile(fs.readFileSync(path.join(outDir, "_headers"), "utf8"));
  const reports: CspReport[] = [];
  const withHeaders = (res: import("node:http").ServerResponse, p: string) => {
    for (const [k, v] of Object.entries(headersFor(rules, p))) {
      const enforce = o.enforceCsp && /^content-security-policy(-report-only)?$/i.test(k);
      res.setHeader(enforce ? "Content-Security-Policy" : k, enforce ? `${v}; report-uri ${CSP_REPORT_PATH}` : v);
    }
  };
  const server: PreviewServer = await preview({
    configFile: false,
    root: path.dirname(outDir),
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port, strictPort: true, open: false },
    plugins: [
      {
        name: "pages-headers",
        configurePreviewServer(s) {
          s.middlewares.use((req, res, next) => {
            const p = new URL(req.url ?? "/", "http://localhost").pathname;
            if (p === CSP_REPORT_PATH && req.method === "POST") {
              let body = "";
              req.on("data", (c: Buffer) => (body += c.toString()));
              req.on("end", () => {
                try {
                  const r = JSON.parse(body)["csp-report"];
                  if (r) reports.push(r);
                } catch {
                  // not a report
                }
                res.statusCode = 204;
                res.end();
              });
              return;
            }
            withHeaders(res, p);
            if (p === CSP_SELFTEST_WORKER) {
              res.setHeader("Content-Type", "text/javascript");
              res.end("try { eval('1') } catch (e) {} postMessage('done');");
              return;
            }
            next();
          });
        },
      },
    ],
  });
  const sw = fs.readFileSync(path.join(outDir, "sw.js"), "utf8");
  const precached = [...sw.matchAll(/url:\s*["']([^"']+)["']\s*,\s*revision:/g)].map((m) => m[1]!.replace(/^\.\//, ""));
  return {
    url: `http://localhost:${port}/`,
    outDir,
    precached,
    reports: () => [...reports],
    close: () => server.close(),
  };
}

/** A copy of a built site in `name/` next to it, to serve on its own origin and change. */
export function copySite(outDir: string, name: string): string {
  const dir = path.join(path.dirname(outDir), name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(outDir, dir, { recursive: true });
  return dir;
}

/**
 * Publishes a new version over `outDir` in place, the way a redeploy changes it: index.html carries
 * the label in `<meta name="shadowlocks-build">`, and sw.js gets a new revision for index.html.
 */
export function deployUpdate(outDir: string, label: string): void {
  const indexFile = path.join(outDir, "index.html");
  const html = fs.readFileSync(indexFile, "utf8");
  fs.writeFileSync(indexFile, html.replace("<head>", `<head>\n    <meta name="shadowlocks-build" content="${label}" />`));
  const swFile = path.join(outDir, "sw.js");
  const sw = fs.readFileSync(swFile, "utf8");
  const next = sw.replace(/(url:\s*["']index\.html["']\s*,\s*revision:\s*["'])([^"']*)(["'])/, `$1$2-${label}$3`);
  if (next === sw) throw new Error("deployUpdate: no index.html entry in sw.js");
  fs.writeFileSync(swFile, next);
}

