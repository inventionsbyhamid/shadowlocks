/**
 * Chromium flags for software WebGL2 in a headless container: the same set IWSDK's own managed
 * browser uses when there is no GPU (SwiftShader through ANGLE).
 */
export const CHROME_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--enable-webgl",
  "--ignore-certificate-errors",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
];
