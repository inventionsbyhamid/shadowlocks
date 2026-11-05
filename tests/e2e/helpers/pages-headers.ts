// Reads a Cloudflare Pages `_headers` file, so the e2e preview server answers with the headers the
// host would send (the CSP above all). Supports path rules with one `*` splat and `:name`
// placeholders, `! Name` to detach, and comments. Absolute URL rules (per host) are ignored.

export interface HeaderRule {
  pattern: RegExp;
  set: Array<[string, string]>;
  detach: string[];
}

function toRegExp(path: string): RegExp {
  let re = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    if (c === "*") re += "(.*)";
    else if (c === ":" && /[A-Za-z]/.test(path[i + 1] ?? "")) {
      while (/\w/.test(path[i + 1] ?? "")) i++;
      re += "([^/]+)";
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = line.startsWith("/") ? { pattern: toRegExp(line), set: [], detach: [] } : null;
      if (current) rules.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("!")) current.detach.push(line.slice(1).trim());
    else {
      const at = line.indexOf(":");
      if (at > 0) current.set.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return rules;
}

/** The headers for `pathname`: every matching rule in order, repeats joined with ", ", then detaches. */
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string> {
  const out = new Map<string, [string, string]>();
  const detached = new Set<string>();
  for (const r of rules) {
    if (!r.pattern.test(pathname)) continue;
    for (const [name, value] of r.set) {
      const key = name.toLowerCase();
      const had = out.get(key);
      out.set(key, had ? [had[0], `${had[1]}, ${value}`] : [name, value]);
    }
    for (const name of r.detach) detached.add(name.toLowerCase());
  }
  const result: Record<string, string> = {};
  for (const [key, [name, value]] of out) if (!detached.has(key)) result[name] = value;
  return result;
}
