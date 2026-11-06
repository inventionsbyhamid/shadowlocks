// Shared helpers for the menu view model tests.
import { expect } from "vitest";
import { newProfile, type Profile } from "../../../src/core/profile";

/** Local time: day key 2026-11-3 (a Tuesday), Daily #3. */
export const NOV3 = new Date(2026, 10, 3, 9, 30);

const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/;

export function profile(over: Partial<Profile> = {}): Profile {
  return { ...newProfile(NOV3.getTime(), "1.0.0"), ...over };
}

/** Every string in a view, for the copy rules. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

/** No em or en dashes (or minus signs standing in for them) anywhere in a view. */
export function expectCleanCopy(v: unknown): void {
  for (const s of strings(v)) expect(s, s).not.toMatch(DASHES);
}

/** A PanelUi that records every paint call as a line ("text id value", "show id true", ...). */
export function recorder() {
  const calls: string[] = [];
  const ui = {
    text: (id: string, t: string) => calls.push(`text ${id} ${t}`),
    show: (id: string, on: boolean) => calls.push(`show ${id} ${on}`),
    visible: (id: string, on: boolean) => calls.push(`visible ${id} ${on}`),
    fill: (id: string, c: string) => calls.push(`fill ${id} ${c}`),
    ink: (id: string, c: string) => calls.push(`ink ${id} ${c}`),
    edge: () => {},
    roll: () => {},
  };
  return { calls, ui };
}
