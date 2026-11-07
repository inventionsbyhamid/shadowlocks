/* eslint-disable @typescript-eslint/no-explicit-any */
// The `test` every spec uses: a `boot` fixture bound to the page. On failure it attaches the console,
// the test hooks' state, the IWER command log and a capture (files under test-results/artifacts/<test>/).
// Every test also fails if its browser context (pages, popups, service workers, WebSockets) reached
// any host but the local server (offline rule); `test.use({ allowedHosts: [...] })` exempts hosts.
import fs from "node:fs";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { boot as bootPage, type BootOptions, watch } from "./boot";
import type { XrApp } from "./xr-app";

export { expect };

export type BootFn = (o?: Omit<BootOptions, "testInfo" | "consoleLines">) => Promise<XrApp>;

async function attachFailure(page: Page, testInfo: TestInfo, consoleLines: string[], hosts: string[]): Promise<void> {
  const text = async (name: string, body: string) => {
    const file = testInfo.outputPath(name);
    fs.writeFileSync(file, body);
    await testInfo.attach(name, { path: file, contentType: "text/plain" });
  };
  await text("console.txt", consoleLines.join("\n") || "(no console output)");
  const state = await page
    .evaluate(() => JSON.stringify((window as any).__ns?.state() ?? null, null, 2))
    .catch((e) => `state unavailable: ${String(e)}`);
  await text("ns-state.json", state);
  const cmds = await page
    .evaluate(() => ((window as any).__nsCmd?.history ?? []) as string[])
    .catch((e) => [`command log unavailable: ${String(e)}`]);
  await text("iwer-commands.txt", cmds.join("\n") || "(no IWER commands)");
  if (hosts.length) await text("foreign-hosts.txt", hosts.join("\n"));
  let png: Buffer | null = null;
  try {
    const url = await page.evaluate(() => {
      const w = window as any;
      if (!w.__nsCapture || !w.__vt) return null;
      w.__nsRoomFrame = true;
      try {
        w.__vt.step(1000 / 72);
      } finally {
        w.__nsRoomFrame = false;
      }
      return w.__nsCapture("image/png") as string;
    });
    if (url) png = Buffer.from(url.split(",")[1] ?? "", "base64");
  } catch {
    png = null;
  }
  if (!png) png = await page.screenshot({ timeout: 30_000 }).catch(() => null);
  if (png) {
    const file = testInfo.outputPath("failure.png");
    fs.writeFileSync(file, png);
    await testInfo.attach("failure.png", { path: file, contentType: "image/png" });
  }
}

export const test = base.extend<{ boot: BootFn; allowedHosts: string[] }>({
  allowedHosts: [[], { option: true }],
  boot: async ({ page, allowedHosts }, use, testInfo) => {
    const consoleLines: string[] = [];
    const seen = watch(page, consoleLines);
    await use((o = {}) => bootPage(page, { ...o, testInfo, consoleLines }));
    const hosts = [...seen.hosts].filter((h) => !allowedHosts.includes(h)).sort();
    if (testInfo.status !== testInfo.expectedStatus) {
      await attachFailure(page, testInfo, consoleLines, hosts);
      return;
    }
    expect(hosts, "the browser reached hosts other than the local server (the game must work offline)").toEqual([]);
  },
});
