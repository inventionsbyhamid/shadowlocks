import { type Settings, settingsFrom } from "../core/profile";
import type { ProfileStore } from "./profile-store";

/** Settings with the same ranges and defaults the profile loader enforces. */
export function cleanSettings(s: Settings): Settings {
  return settingsFrom(s);
}

/** Live settings: read anywhere, change through `set`, which clamps, saves and notifies. */
export class SettingsStore {
  private readonly subs = new Set<(s: Readonly<Settings>) => void>();

  constructor(private readonly profiles: ProfileStore) {}

  get(): Readonly<Settings> {
    return this.profiles.profile.settings;
  }

  set(patch: Partial<Settings>): Promise<void> {
    const next = cleanSettings({ ...this.profiles.profile.settings, ...patch });
    this.profiles.profile.settings = next;
    for (const fn of [...this.subs]) {
      try {
        fn(next);
      } catch (err) {
        console.error("settings subscriber failed", err);
      }
    }
    return this.profiles.save();
  }

  subscribe(fn: (s: Readonly<Settings>) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
