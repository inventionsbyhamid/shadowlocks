// Browsers start audio only from a gesture. Each gesture tries again until the engine really
// runs (unlocked, its context running): a try with no gesture behind it (an installed app that
// enters XR by itself) can leave the context's resume() pending for good, and a context that
// started by itself (autoplay allowed) still needs the engine's unlock before anything plays.

/** What starting audio needs of the engine. */
export interface Unlockable {
  readonly running: boolean;
  unlock(): Promise<void>;
}

/** A gesture (or a likely one): start audio unless it already runs. Safe to call on every gesture. */
export function startAudio(engine: Unlockable): void {
  if (engine.running) return;
  void engine.unlock();
}
