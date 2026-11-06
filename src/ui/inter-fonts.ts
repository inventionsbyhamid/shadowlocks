// Stands in for @pmndrs/msdfonts/inter (vite.config.ts aliases it here): UIKit's own default font family imports
// that module, whose atlases have no accents (no é, ç, ñ, ã). Ours, built by scripts/fonts with all of Latin-1,
// serve the default too, and the package's 270 KB of embedded atlases stay out of the build.
const url = (f: string) => `${import.meta.env.BASE_URL}fonts/${f}.json`;

export const INTER_MEDIUM = url("inter-md");
export const INTER_BOLD = url("inter-bd");

/** The shape UIKit reads (`inter[weight]`), each weight our nearest atlas. */
export const inter = { light: INTER_MEDIUM, medium: INTER_MEDIUM, "semi-bold": INTER_BOLD, bold: INTER_BOLD };
