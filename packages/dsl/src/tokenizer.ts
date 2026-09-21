export type TokenType =
  | "ident"
  | "ref"
  | "string"
  | "number"
  | "color"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "colon"
  | "comma"
  | "percent"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const HEX = /^[0-9a-fA-F]+$/;
const IDENT_START = /[a-zA-Z_]/;
const IDENT_ATOM = /[a-zA-Z0-9_-]/;

export interface TokenizeResult {
  tokens: Token[];
  errors: { message: string; line: number; col: number }[];
}

/** Whitespace-insensitive, brace-blocked Claro tokenizer. */
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const errors: TokenizeResult["errors"] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function peek(off = 0): string {
    return source[i + off] ?? "";
  }
  function advance(): string {
    const c = source[i] ?? "";
    i++;
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  }

  while (i < source.length) {
    const c = peek();

    // whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      advance();
      continue;
    }

    // comments
    if (c === "#") {
      const hexAhead = /^[0-9a-fA-F]{3,8}\b/.test(source.slice(i + 1, i + 10));
      if (hexAhead) {
        // color literal
        const startLine = line, startCol = col;
        advance(); // '#'
        while (/[0-9a-fA-F]/.test(peek())) advance();
        tokens.push({ type: "color", value: source.slice(startCol - 1, col - 1), line: startLine, col: startCol });
        continue;
      }
      while (peek() && peek() !== "\n") advance();
      continue;
    }
    if (c === "/" && peek(1) === "/") {
      while (peek() && peek() !== "\n") advance();
      continue;
    }

    // symbols
    const sym: Record<string, TokenType> = {
      "{": "lbrace", "}": "rbrace",
      "(": "lparen", ")": "rparen",
      "[": "lbracket", "]": "rbracket",
      ":": "colon", ",": "comma", "%": "percent",
    };
    if (sym[c]) {
      tokens.push({ type: sym[c], value: c, line, col });
      advance();
      continue;
    }

    // string
    if (c === '"') {
      const startLine = line, startCol = col;
      advance();
      let value = "";
      while (peek() && peek() !== '"') {
        if (peek() === "\\") {
          advance();
          const esc = advance();
          value += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === '"' ? '"' : esc === "\\" ? "\\" : esc;
        } else {
          value += advance();
        }
      }
      if (peek() !== '"') {
        errors.push({ message: "unterminated string", line: startLine, col: startCol });
      } else {
        advance();
      }
      tokens.push({ type: "string", value, line: startLine, col: startCol });
      continue;
    }

    // ref @name
    if (c === "@") {
      const startLine = line, startCol = col;
      advance();
      if (!IDENT_START.test(peek())) {
        errors.push({ message: "expected identifier after @", line: startLine, col: startCol });
        continue;
      }
      let name = "";
      while (IDENT_ATOM.test(peek())) name += advance();
      tokens.push({ type: "ref", value: name, line: startLine, col: startCol });
      continue;
    }

    // number
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(peek(1)))) {
      const startLine = line, startCol = col;
      let num = "";
      if (c === "-") num += advance();
      while (/[0-9]/.test(peek())) num += advance();
      if (peek() === "." && /[0-9]/.test(peek(1))) {
        num += advance();
        while (/[0-9]/.test(peek())) num += advance();
      }
      tokens.push({ type: "number", value: num, line: startLine, col: startCol });
      continue;
    }

    // ident or color-word handled as ident
    if (IDENT_START.test(c)) {
      const startLine = line, startCol = col;
      let word = "";
      while (IDENT_ATOM.test(peek())) word += advance();
      tokens.push({ type: "ident", value: word, line: startLine, col: startCol });
      continue;
    }

    errors.push({ message: `unexpected character '${c}'`, line, col });
    advance();
  }

  tokens.push({ type: "eof", value: "", line, col });
  return { tokens, errors };
}

/** True if an ident token is a valid color literal in a value position. */
export function isHexColor(word: string): boolean {
  return HEX.test(word);
}