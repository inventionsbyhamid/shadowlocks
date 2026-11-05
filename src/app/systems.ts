// Register the app's own ECS systems here, not with world.registerSystem directly: the registry
// lets the test hooks time every one of them for the per-frame JS budget.
import type { World } from "@iwsdk/core";

/** Anything with a per-frame update (every IWSDK system). */
export interface AppSystem {
  update(delta: number, time: number): void;
}

export interface AppSystemOptions {
  priority?: number;
  configData?: Record<string, unknown>;
  /** What the per-frame budget calls it (builds rename classes); the class name when left out. */
  name?: string;
}

const registered: AppSystem[] = [];
const names = new WeakMap<AppSystem, string>();
const watchers = new Set<(s: AppSystem) => void>();

/** `world.registerSystem(cls, opts)`, recorded so the per-frame budget covers it. Returns the instance. */
export function registerAppSystem<T extends AppSystem>(
  world: World,
  cls: abstract new (...args: never[]) => T,
  opts?: AppSystemOptions,
): T {
  const { name, ...rest } = opts ?? {};
  world.registerSystem(cls as never, (opts ? rest : undefined) as never);
  const sys = world.getSystem(cls as never) as unknown as T | undefined;
  if (!sys) throw new Error(`system ${cls.name} did not register`);
  registered.push(sys);
  names.set(sys, name ?? cls.name);
  for (const fn of watchers) fn(sys);
  return sys;
}

/** The name a system was registered under (for the per-system budget). */
export function appSystemName(sys: AppSystem): string {
  return names.get(sys) ?? "system";
}

export function appSystems(): readonly AppSystem[] {
  return registered;
}

/** Call `fn` for every app system, now and as more register. Returns an unsubscribe. */
export function onAppSystem(fn: (s: AppSystem) => void): () => void {
  for (const s of registered) fn(s);
  watchers.add(fn);
  return () => watchers.delete(fn);
}
