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
    this.changed();
    return this.profiles.save();
  }

  /** Tell the subscribers the settings changed (`set`, and `replaced` when another window's differ). */
  changed(): void {
    const s = this.get();
    for (const fn of [...this.subs]) {
      try {
        fn(s);
      } catch (err) {
        console.error("settings subscriber failed", err);
      }
    }
  }

  /**
   * The profile under the settings was replaced (another window's taken in, profile-store.ts onAdopt): tell the
   * subscribers when the settings now differ from `held`, the ones this window held, and showed, until then. So the
   * window shows the stored settings (box size, hand and the rest). Compared with those, not with the ones it last
   * saved: a change whose save was refused is on screen, and must be undone there. Nothing when they are the same: a
   * subscriber may rebuild something for nothing (the Left hand setting mirrors the box behind the menus).
   */
  replaced(held: Readonly<Settings>): void {
    if (JSON.stringify(cleanSettings(held)) !== JSON.stringify(cleanSettings(this.get()))) this.changed();
  }

  subscribe(fn: (s: Readonly<Settings>) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
