import { describe, it, expect } from "vitest";
import { parse, type Project } from "@project/dsl";
import { buildAndroid, androidSignature } from "../src/index.js";

const CANON = `page Home {
    section Hero {
        layout: stack
        gap: 24
        padding: 48
        heading "Build differently"
        text "Reversible, AI-native UI." {
            color: #c8c8d0
            size: 18
        }
        button primary "Get Started"
    }
}
`;

function proj(): Project {
  return parse(CANON);
}

describe("buildAndroid — parity & structure", () => {
  it("emits a compilable-looking Compose file with imports and a Screen fn", () => {
    const out = buildAndroid(proj());
    expect(out).toContain("import androidx.compose.foundation.layout.*");
    expect(out).toContain("import androidx.compose.runtime.Composable");
    expect(out).toContain("@Composable");
    expect(out).toContain("fun HomeScreen() {");
    expect(out).toContain("Column {");
    expect(out).toContain("Text(\"Build differently\", fontWeight = FontWeight.SemiBold)");
    expect(out).toContain("Text(\"Reversible, AI-native UI.\", color = Color(0xFFC8C8D0), fontSize = 18.sp)");
    expect(out).toContain("Button(onClick = { }) {");
    expect(out).toContain("Text(\"Get Started\")");
  });

  it("is deterministic (build twice, same output)", () => {
    expect(buildAndroid(proj())).toBe(buildAndroid(proj()));
  });

  it("preserves element order, text, and nesting (html-signature subset)", () => {
    // Signatures: element kinds in DFS order with text. The HTML renderer
    // emits the same DFS order (see apps/ide/src/export/renderHtml.ts), so
    // codegen vs preview must agree on structure, not style.
    const sig = androidSignature(proj());
    expect(sig).toContain("Box(Text:Build differently,Text:Reversible, AI-native UI.,Button:Get Started)");
    expect(sig).toContain("Text:Build differently");
    expect(sig).toContain("Text:Reversible, AI-native UI.");
    expect(sig).toContain("Button:Get Started");
  });

  it("renders components as composables + a registry mapping", () => {
    const src = `component Hero(title: string, cta: string) {
        heading @title
        button @cta
    }
page Home {
    Hero(title: "Hello", cta: "Go")
}
`;
    const p = parse(src);
    const out = buildAndroid(p);
    expect(out).toContain("fun Hero(");
    expect(out).toContain("title: String = \"\"");
    expect(out).toContain("cta: String = \"\"");
    expect(out).toContain("@title");
    expect(out).toContain("componentRegistry");
    expect(out).toContain('"Hero" to');
  });

  it("maps colors and units to Android forms", () => {
    const p = newProj(`page Home {
    container {
        background: #aabbcc
        padding: 16
        gap: 8
        heading "Tint" {
            color: #f00
            size: 24
        }
    }
}`);
    const out = buildAndroid(p);
    expect(out).toContain("Color(0xFFAABBCC)");
    expect(out).toContain("Modifier.padding(16.dp)");
    expect(out).toContain("24.sp");
    expect(out).toContain("Color(0xFFFF0000)");
  });

  it("handles every reference.md element without throwing", () => {
    const src = `page Home {
    section s {
        container c
        row r { }
        stack st
        grid g { columns: [1fr 2fr] }
        overlay o
        heading "h"
        text "t"
        button "b"
        card ca
        navbar nv
        input inp label: "in" type: "email"
        textarea ta
        form f
        modal m title: "m"
        image img src: "x" alt: "a"
        spacer sp size: 12
        divider dv
        badge bd "warn"
    }
}`;
    const p = parse(src);
    expect(() => buildAndroid(p)).not.toThrow();
    const out = buildAndroid(p);
    for (const el of ["Box", "Row", "Text", "Image", "Spacer", "Divider"]) {
      expect(out).toContain(el);
    }
  });
});

function newProj(src: string): Project {
  return parse(src);
}