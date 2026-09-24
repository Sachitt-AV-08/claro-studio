import { describe, it, expect } from "vitest";
import { parse, format, formatSource, applyOps, applyOp, suggestions, tokenize } from "../src/index.js";
import { nodeById, getLanguageKnowledge, ELEMENTS, SYNONYMS } from "@project/contracts";

const CANON = `page Home {
    section Hero {
        layout: stack
        gap: 24
        padding: 48
        heading "Build differently"
        button primary "Get Started"
    }
}
`;

describe("round-trip & idempotence", () => {
  it("formats canonical source exactly", () => {
    expect(formatSource(CANON)).toBe(CANON);
  });

  it("format(format(x)) === format(x)", () => {
    const once = formatSource(CANON);
    const twice = formatSource(once);
    expect(twice).toBe(once);
  });

  it("parse -> format -> parse is stable", () => {
    const a = formatSource(CANON);
    const b = formatSource(a);
    expect(b).toBe(a);
  });

  it("produces stable nodeIds", () => {
    const p1 = parse(CANON);
    const p2 = parse(formatSource(CANON));
    const ids1 = collectIds(p1);
    const ids2 = collectIds(p2);
    expect(ids2).toEqual(ids1);
    expect(ids1).toContain("home.hero");
    expect(ids1).toContain("home.hero.primary");
  });
});

describe("chaos & indentation", () => {
  it("parses wildly indented, mixed-case, semicolon'd source", () => {
    const messy = `PAGE          Home    \n {
       Section     Hero {
          Layout   :       STACK
   gap  :  24\ttabs and    padding  :  48 ;
  heading       "Build differently"
  button   primary   "Go"  { radius : 16 ; }
        }
}`;
    const p = parse(messy);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    const once = formatSource(messy);
    expect(once).toContain("layout: stack");
    expect(once).toContain("gap: 24");
    expect(once).toContain("padding: 48");
    expect(once).toContain('button primary "Go"');
    expect(once).toContain("radius: 16");
    expect(formatSource(once)).toBe(once);
  });

  it("never throws on a missing closing brace", () => {
    const p = parse(`page Home { section Hero { heading "x"`);
    expect(() => parse(`page Home { section Hero { heading "x"`)).not.toThrow();
    expect(p.pages.length).toBe(1);
  });

  it("never throws on stray tokens", () => {
    expect(() => parse(`page } { { { }}} ## %% @`)).not.toThrow();
  });

  it("strips markdown fences", () => {
    const fenced = "```cl\n" + CANON + "```\n";
    expect(formatSource(fenced)).toBe(CANON);
  });

  it("recognizes single-quote strings", () => {
    const p = parse(`page Home { text 'yo' }`);
    const t = nodeById(p.pages[0].children, "home.yo") ?? nodeById(p.pages[0].children, "home.text");
    expect(t?.text).toBe("yo");
  });

  it("na: duplicate property last-wins with a warning", () => {
    const p = parse(`page Home { section S { gap: 10; gap: 20 } }`);
    const s = nodeById(p.pages[0].children, "home.s");
    expect(s?.props.gap).toMatchObject({ t: "num", v: 20 });
    expect(p.diagnostics.some((d) => d.code === "dup-prop")).toBe(true);
  });

  it("suggests 'padding' for the typo pxxading", () => {
    const p = parse(`page Home { section S { pxxading: 12 } }`);
    const hit = p.diagnostics.find((d) => d.code === "unknown-prop");
    expect(hit?.message).toContain("padding");
  });
});

describe("english affordances", () => {
  it("accepts and strips articles & conjunctions", () => {
    const src = `page Home {
    section Hero {
        gap: 24 and align: center
        the button primary "Go"
    }
}
`;
    const p = parse(src);
    expect(p.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    const out = formatSource(src);
    expect(out).not.toContain("the ");
    expect(out).not.toContain("and align");
    expect(out).toContain("align: center");
    expect(out).toContain('button primary "Go"');
  });
});

describe("components & refs", () => {
  const COMPONENT = `component Hero(title: string, cta: string) {
    heading @title
    button @cta
}
`;
  it("parses params and ref-bound text", () => {
    const p = parse(COMPONENT);
    expect(p.components.length).toBe(1);
    const h = p.components[0];
    expect(h.params).toHaveLength(2);
    expect(h.children[0].textRef).toBe("title");
  });

  it("round-trips component source unchanged", () => {
    expect(formatSource(COMPONENT)).toBe(COMPONENT);
  });

  it("rejects reserved component names", () => {
    const p = parse(`component button(x: string) { text @x }`);
    expect(p.diagnostics.some((d) => d.code === "reserved-name")).toBe(true);
  });
});

describe("values", () => {
  it("parses number units and percents", () => {
    const p = parse(`page Home { section S { gap: 24 height: 50% width: 2fr } }`);
    const s = nodeById(p.pages[0].children, "home.s");
    expect(s?.props.gap).toEqual({ t: "num", v: 24, unit: undefined });
    expect(s?.props.height).toEqual({ t: "num", v: 50, unit: "%" });
    expect(s?.props.width).toEqual({ t: "num", v: 2, unit: "fr" });
  });

  it("parses grid lists and color functions", () => {
    const p = parse(`page Home { grid G { columns: [1fr 2fr 1fr] } }`);
    const g = nodeById(p.pages[0].children, "home.g");
    expect(g?.props.columns).toMatchObject({ t: "list" });
    const p2 = parse(`page Home { card C { shadow: 0 4 rgba(0, 0, 0, 0.2) } }`);
    const c = nodeById(p2.pages[0].children, "home.c");
    expect(c?.props.shadow?.t).toBe("tuple");
    const shadow = c?.props.shadow;
    if (shadow && shadow.t === "tuple") {
      expect(shadow.v[2]).toMatchObject({ t: "color" });
    }
  });

  it("validates enums and warns", () => {
    const p = parse(`page Home { button primary "Go" { variant: fancyish } }`);
    expect(p.diagnostics.some((d) => d.code === "bad-enum")).toBe(true);
  });
});

describe("patches", () => {
  const src = `page Home {
    section Hero {
        heading title "Title"
        button primary "Go"
    }
}
`;

  it("rejects an op targeting a missing node", () => {
    const p = parse(src);
    const res = applyOp(p, { op: "set_property", target: "nope.missing", property: "gap", value: { t: "num", v: 40 } });
    expect(res.ok).toBe(false);
  });

  it("set_property applies and inverse restores", () => {
    const p = parse(src);
    const res = applyOps(p, [{ op: "set_property", target: "home.hero", property: "gap", value: { t: "num", v: 40, unit: "px" } }]);
    expect(res.ok).toBe(true);
    const hero = nodeById(p.pages[0].children, "home.hero");
    expect(hero?.props.gap).toMatchObject({ t: "num", v: 40 });
    const undo = res.ok ? applyOps(p, res.inverse) : null;
    expect(undo?.ok).toBe(true);
    expect(nodeById(undo ? p.pages[0].children : [], "home.hero")?.props.gap).toBeUndefined();
  });

  it("add_element then remove_element inverse restores original text", () => {
    const before = formatSource(src);
    const p = parse(src);
    const el = parse(`page Home { text "NEW" }`).pages[0].children[0];
    const res = applyOps(p, [{ op: "add_element", parent: "home.hero", element: el, position: "last" }]);
    expect(res.ok).toBe(true);
    expect(format(p)).not.toBe(before);
    const undo = applyOps(p, res.ok ? res.inverse : []);
    expect(undo.ok).toBe(true);
    expect(format(p)).toBe(before);
  });

  it("move_element swaps order and inverse restores", () => {
    const p = parse(src);
    const res = applyOps(p, [{ op: "move_element", target: "home.hero.primary", position: "first" }]);
    expect(res.ok).toBe(true);
    const hero = nodeById(p.pages[0].children, "home.hero");
    expect(hero?.children[0].nodeId).toBe("home.hero.primary");
    const undo = applyOps(p, res.ok ? res.inverse : []);
    expect(undo.ok).toBe(true);
    const hero2 = nodeById(undo ? p.pages[0].children : [], "home.hero");
    expect(hero2?.children[0].nodeId).toBe("home.hero.title");
  });

  it("set_text works and inverses", () => {
    const p = parse(src);
    const res = applyOps(p, [{ op: "set_text", target: "home.hero.title", value: "New Title" }]);
    expect(res.ok).toBe(true);
    expect(nodeById(p.pages[0].children, "home.hero.title")?.text).toBe("New Title");
    const undo = applyOps(p, res.ok ? res.inverse : []);
    expect(nodeById(undo ? p.pages[0].children : [], "home.hero.title")?.text).toBe("Title");
  });

  it("clear_property removes and inverse restores", () => {
    const withGap = `page Home { section Hero { gap: 24 } }\n`;
    const p = parse(withGap);
    const res = applyOps(p, [{ op: "clear_property", target: "home.hero", property: "gap" }]);
    expect(res.ok).toBe(true);
    expect(nodeById(p.pages[0].children, "home.hero")?.props.gap).toBeUndefined();
    const undo = applyOps(p, res.ok ? res.inverse : []);
    expect(undo.ok).toBe(true);
    expect(nodeById(undo ? p.pages[0].children : [], "home.hero")?.props.gap).toMatchObject({ t: "num", v: 24 });
  });

  it("set_layout applies and inverses", () => {
    const p = parse(src);
    const res = applyOps(p, [{ op: "set_layout", target: "home.hero", layout: "row" }]);
    expect(res.ok).toBe(true);
    expect(nodeById(p.pages[0].children, "home.hero")?.props.layout).toMatchObject({ t: "enum", v: "row" });
    const undo = applyOps(p, res.ok ? res.inverse : []);
    expect(nodeById(undo ? p.pages[0].children : [], "home.hero")?.props.layout).toBeUndefined();
  });
});

describe("comment preservation (comment-as-idea)", () => {
  const WITH_COMMENTS = `# top of file
page Home {
    // hero is the first fold
    section Hero {
        layout: stack
        # pitch the product here
        heading "Build differently"
        button primary "Get Started" // trailing note
    }
}
`;

  it("captures comments as trivia, never drops them", () => {
    const p = parse(WITH_COMMENTS);
    const all: string[] = [...(p.comments ?? []).map((c) => c.text)];
    const walk = (n: { comments?: { text: string }[]; tailComments?: { text: string }[]; children?: unknown[] }) => {
      for (const c of [...(n.comments ?? []), ...(n.tailComments ?? [])]) all.push(c.text);
      for (const c of (n.children ?? []) as { comments?: { text: string }[]; tailComments?: { text: string }[]; children?: unknown[] }[]) walk(c);
    };
    p.pages.forEach(walk);
    expect(all).toContain("top of file");
    expect(all).toContain("hero is the first fold");
    expect(all).toContain("pitch the product here");
    expect(all).toContain("trailing note");
  });

  it("formatting normalizes but keeps content byte-true", () => {
    const out = formatSource(WITH_COMMENTS);
    expect(out).toContain("# Top of file");
    expect(out).toContain("# Hero is the first fold");
    expect(out).toContain("# Pitch the product here");
    expect(out).toContain("# Trailing note");
  });

  it("format() never drops comments (round-trip is monotonic)", () => {
    const once = formatSource(WITH_COMMENTS);
    const twice = formatSource(once);
    expect(twice).toBe(once);
    const count = (s: string) => (s.match(/^\s*#/gm) ?? []).length;
    expect(count(twice)).toBeGreaterThanOrEqual(4);
    expect(count(twice)).toBe(count(once));
  });

  it("#hex is still a color, not a comment", () => {
    const p = formatSource(`page Home { section s { background: #aabbcc } }`);
    expect(p).toContain("background: #aabbcc");
    expect(p).not.toContain("# Aabbcc");
  });
});

describe("tokenizer & suggestions", () => {
  it("tolerates optional semicolons", () => {
    const { tokens } = tokenize(`gap: 24; align: center;`);
    expect(tokens.some((t) => t.value === ";")).toBe(false);
  });

  it("strips BOM and CRLF", () => {
    const { tokens } = tokenize("\uFEFFgap: 24\r\nalign: center");
    expect(tokens.map((t) => t.value).filter(Boolean)).toContain("gap");
  });

  it("suggests close candidates", () => {
    expect(suggestions("pxxading", Object.keys({ padding: 1, margin: 2 }))).toContain("padding");
    expect(suggestions("buton", ["button", "badge", "spacer"])).toContain("button");
  });
});

describe("getLanguageKnowledge (single source of truth)", () => {
  it("is exhaustive against dsl-schema.ts", () => {
    const k = getLanguageKnowledge();
    const elementTypes = k.elements.map((e) => e.type);
    expect(elementTypes.sort()).toEqual(Object.keys(ELEMENTS).sort());
    for (const e of k.elements) {
      for (const p of e.props) {
        expect(Object.keys(ELEMENTS[e.type].props)).toContain(p.name);
      }
    }
    for (const [syn] of Object.entries(SYNONYMS)) expect(k.synonyms[syn]).toBe(SYNONYMS[syn]);
  });

  it("covers units, enums, layouts, and PatchOps", () => {
    const k = getLanguageKnowledge();
    expect(k.units).toContain("fr");
    expect(k.layouts).toEqual(["stack", "row", "grid", "overlay"]);
    expect(k.enums["button.variant"]).toContain("ghost");
    const ops = k.patchOps.map((o) => o.op);
    expect(ops).toContain("set_property");
    expect(ops).toContain("set_layout");
    expect(ops).toContain("add_element");
  });

  it("is exhaustive and parseable by typecheck (blurb present)", () => {
    const k = getLanguageKnowledge();
    expect(k.name).toBe("Claro");
    expect(k.extension).toBe(".cl");
    expect(k.blurb.length).toBeGreaterThan(50);
    expect(k.valueTypes.map((v) => v.type)).toEqual(["number", "string", "color", "boolean", "enum", "ref", "list"]);
  });
});

function collectIds(project: { pages: { nodeId: string }[]; components: { nodeId: string }[] }): string[] {
  const out: string[] = [];
  const walk = (n: { nodeId: string; children?: { nodeId: string }[] }) => {
    out.push(n.nodeId);
    n.children?.forEach(walk);
  };
  project.pages.forEach(walk);
  project.components.forEach(walk);
  return out;
}