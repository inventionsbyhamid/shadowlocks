// The shape every language's table has: exactly the English source's keys (src/ui/copy.ts), with any text in
// place of the English. A table declared as `Copy` that misses a key, adds one, or has a list of another length
// does not compile.
import type { COPY } from "../ui/copy";

type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };

export type Copy = Widen<typeof COPY>;

/** A count's plural forms: `one` where the language's rules say so (1 in English; 0 and 1 in French), else `other`. */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

/** A no-break space: before French : ; ? ! and inside « », and between "n°" and its number. */
export const NBSP = " ";
