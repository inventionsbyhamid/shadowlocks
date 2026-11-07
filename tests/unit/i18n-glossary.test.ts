// The glossary: the game's key terms, fixed per language before any line was written, and a check that every line
// that uses a term in English uses the same term in each language (any inflection of it). A line may leave a term
// out only where the language says it better without it, listed in EXCEPT with the reason.
import { describe, expect, it } from "vitest";
import { type Lang, LANGS, tableFor } from "../../src/i18n";
import { COPY } from "../../src/ui/copy";

type Others = Exclude<Lang, "en">;

interface Term {
  en: RegExp;
  /** The fixed term, as a pattern that takes its inflections. */
  in: Record<Others, RegExp>;
}

const GLOSSARY: Record<string, Term> = {
  lantern: { en: /lantern/i, in: { es: /farol/i, fr: /lanterne/i, de: /laterne/i, "pt-BR": /lanterna/i, ja: /ランタン/ } },
  lock: { en: /\blocks?\b/i, in: { es: /cerradura/i, fr: /serrure/i, de: /schloss|schlöss/i, "pt-BR": /fechadura/i, ja: /錠/ } },
  scrap: { en: /\bscraps?\b/i, in: { es: /recorte/i, fr: /découpe/i, de: /plättchen/i, "pt-BR": /recorte/i, ja: /かけら/ } },
  piece: { en: /\bpieces?\b/i, in: { es: /pieza/i, fr: /pièce/i, de: /\bteile?\b/i, "pt-BR": /peça/i, ja: /ピース/ } },
  box: { en: /\bbox(es)?\b/i, in: { es: /caja/i, fr: /boîte/i, de: /box/i, "pt-BR": /caixa/i, ja: /箱/ } },
  dailyBox: { en: /daily box/i, in: { es: /caja del día/i, fr: /boîte du jour/i, de: /tagesbox/i, "pt-BR": /caixa do dia/i, ja: /今日の箱/ } },
  ring: { en: /\brings?\b/i, in: { es: /anillo/i, fr: /anneau/i, de: /\bringe?\b/i, "pt-BR": /anel|anéis/i, ja: /リング/ } },
  hint: { en: /\bhints?\b/i, in: { es: /pista/i, fr: /indice/i, de: /hinweis/i, "pt-BR": /pista/i, ja: /ヒント/ } },
  tip: { en: /\btips?\b/i, in: { es: /consejo/i, fr: /astuce/i, de: /tipp/i, "pt-BR": /dica/i, ja: /コツ/ } },
  fullGame: { en: /full game/i, in: { es: /juego completo/i, fr: /jeu complet/i, de: /vollversion/i, "pt-BR": /jogo completo/i, ja: /製品版/ } },
  lesson: { en: /\blessons?\b/i, in: { es: /lecci[oó]n/i, fr: /leçon/i, de: /lektion/i, "pt-BR": /liç(ão|ões)/i, ja: /レッスン/ } },
  drawer: { en: /drawer/i, in: { es: /cajón/i, fr: /tiroir/i, de: /schublade/i, "pt-BR": /gaveta/i, ja: /引き出し/ } },
  shadow: { en: /shadows?/i, in: { es: /sombra/i, fr: /ombre/i, de: /schatten/i, "pt-BR": /sombra/i, ja: /影/ } },
  outline: { en: /outline/i, in: { es: /contorno/i, fr: /contour/i, de: /umriss/i, "pt-BR": /contorno/i, ja: /輪郭/ } },
  light: { en: /\blight\b/i, in: { es: /\bluz\b/i, fr: /lumière/i, de: /licht/i, "pt-BR": /\bluz\b/i, ja: /光/ } },
  finger: { en: /finger/i, in: { es: /dedo/i, fr: /doigt/i, de: /finger/i, "pt-BR": /dedo/i, ja: /指/ } },
  hand: { en: /\bhands?\b/i, in: { es: /mano/i, fr: /main/i, de: /hand|hände/i, "pt-BR": /mão|mãos/i, ja: /手/ } },
  reward: { en: /rewards?/i, in: { es: /recompensa/i, fr: /récompense/i, de: /fundstück/i, "pt-BR": /recompensa/i, ja: /お宝/ } },
  collection: { en: /collection/i, in: { es: /colección/i, fr: /collection/i, de: /sammlung/i, "pt-BR": /coleção/i, ja: /コレクション/ } },
  streak: { en: /streak/i, in: { es: /racha/i, fr: /série/i, de: /serie/i, "pt-BR": /sequência/i, ja: /連続/ } },
  trial: { en: /\btrial\b/i, in: { es: /prueba/i, fr: /essai/i, de: /testphase/i, "pt-BR": /teste/i, ja: /お試し/ } },
  settings: { en: /\bsettings\b/i, in: { es: /ajustes/i, fr: /réglages/i, de: /optionen/i, "pt-BR": /ajustes/i, ja: /設定/ } },
  controller: { en: /controllers?/i, in: { es: /controlador/i, fr: /manette/i, de: /controller/i, "pt-BR": /controle/i, ja: /コントローラー/ } },
  // Kept as they are (Japanese writes their spaces as no-break spaces: \s takes both).
  metaQuest: { en: /Meta\sQuest/, in: { es: /Meta\sQuest/, fr: /Meta\sQuest/, de: /Meta\sQuest/, "pt-BR": /Meta\sQuest/, ja: /Meta\sQuest/ } },
  store: {
    en: /Meta\sHorizon\sStore/,
    in: { es: /Meta\sHorizon\sStore/, fr: /Meta\sHorizon\sStore/, de: /Meta\sHorizon\sStore/, "pt-BR": /Meta\sHorizon\sStore/, ja: /Meta\sHorizon\sStore/ },
  },
};

/** [term, language, key]: why the line does without the term. */
const EXCEPT: [string, Others | "*", string, string][] = [
  ["box", "*", "game.next", "the key over the plate says 'Next' (Siguiente, Suivante, Nächste, Próxima): the box is implied"],
  ["box", "*", "settings.boxSize", "the slider reads 'Size 24 cm' (Tamaño, Taille, Größe, サイズ): 'box' does not fit beside its value; pt says 'Caixa 24 cm'"],
  ["dailyBox", "fr", "menus.collection.daily", "'Boîte du 2 nov.': the date says which day"],
  ["dailyBox", "ja", "menus.collection.daily", "'11月2日の箱': the date says which day"],
  ["hand", "ja", "settings.hand", "左利き (left-handed) is how Japanese names the setting"],
  ["box", "ja", "panels.home.tagline", "a puzzle box is パズルボックス, one word"],
  ["box", "ja", "landing.tagline", "a puzzle box is パズルボックス, one word"],
  ["shadow", "*", "film.title", "the name stays in English"],
  ["lock", "*", "film.title", "the name stays in English"],
  ["shadow", "*", "panels.home.title", "the name stays in English"],
  ["lock", "*", "panels.home.title", "the name stays in English"],
  ["box", "ja", "landing.description", "a puzzle box is パズルボックス, one word"],
];

function leaves(v: unknown, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}

const excused = (term: string, l: Others, key: string) => EXCEPT.some(([t, el, k]) => t === term && (el === l || el === "*") && k === key);

describe("the glossary", () => {
  // The story lists are names and things, not the game's terms.
  const lines = leaves(COPY).filter(([k]) => !k.startsWith("story."));
  for (const l of LANGS.filter((x): x is Others => x !== "en")) {
    it(`${l} uses the fixed term wherever English uses one`, () => {
      const t = new Map(leaves(tableFor(l)));
      const misses: string[] = [];
      for (const [key, en] of lines) {
        for (const [term, g] of Object.entries(GLOSSARY)) {
          // "Daily Box" is its own term: a line is checked for "box" only where it has another box.
          const text = term === "box" ? en.replace(/daily box/gi, "") : en;
          if (!g.en.test(text) || excused(term, l, key)) continue;
          const s = t.get(key) ?? "";
          if (!g.in[l].test(s)) misses.push(`${term} | ${key} | ${en} | ${s}`);
        }
      }
      expect(misses).toEqual([]);
    });
  }

  it("every exception is still needed (a line that now has its term loses its exception)", () => {
    const stale: string[] = [];
    for (const [term, el, key] of EXCEPT) {
      const en = new Map(leaves(COPY)).get(key);
      expect(en, `${key} is an English key`).toBeDefined();
      const langs = el === "*" ? LANGS.filter((x): x is Others => x !== "en") : [el];
      const g = GLOSSARY[term];
      if (!g) continue;
      if (langs.every((l) => g.in[l].test(new Map(leaves(tableFor(l))).get(key) ?? ""))) stale.push(`${term} ${el} ${key}`);
    }
    expect(stale).toEqual([]);
  });
});
