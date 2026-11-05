import { describe, expect, it } from "vitest";
import { INPUT_PROFILES_CDN, localInputProfileUrl } from "../../src/app/input-profiles";

describe("local input profiles", () => {
  it("maps IWSDK's CDN profile models to our own origin", () => {
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/generic-hand/left.glb`, "./input-profiles")).toBe(
      "./input-profiles/generic-hand/left.glb",
    );
    expect(localInputProfileUrl(`${INPUT_PROFILES_CDN}/meta-quest-touch-plus/right.glb`, "/x/input-profiles/")).toBe(
      "/x/input-profiles/meta-quest-touch-plus/right.glb",
    );
  });

  it("leaves every other URL alone", () => {
    for (const u of ["./ui/home.uikitml", "https://example.com/a.glb", "blob:abc", "data:,x"]) {
      expect(localInputProfileUrl(u, "./input-profiles")).toBe(u);
    }
  });
});
