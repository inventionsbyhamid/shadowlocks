// This build's version: package.json's "version" (the bundle carries only that field). The profile's
// first-launch marker records it, and the paywall update reads a first launch on any version below
// PAYWALL_BUILD (core/entitlement.ts) as "owned". offline.ts's BUILD_KEY ("shadowlocks.build") names a
// build by its hashed bundle URL instead: that tells builds apart but has no order, so it cannot say
// "below 2.0.0".
import { version } from "../../package.json";

export const APP_VERSION: string = version;
