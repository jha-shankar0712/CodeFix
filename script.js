/* =========================================================
   CodeFix — script.js
   Vanilla JS static code analyzer + UI controller.
   No eval(), no backend, no external execution of user code.
   ========================================================= */

(function () {
  "use strict";

  /* ------------------------------------------------------
     0. CONSTANTS & STATE
  ------------------------------------------------------ */
  const STORAGE_KEYS = {
    STATS: "codefix_stats",
    HISTORY: "codefix_history",
  };
  const MAX_HISTORY_ITEMS = 20;
  const MAX_CODE_LENGTH = 20000; // guard against absurdly large pastes

  const DEFAULT_STATS = {
    totalAnalyses: 0,
    errorsDetected: 0,
    fixesSuggested: 0,
  };

  let sessionAnalyses = 0;
  let lastAnalysis = null; // { language, code, issues, fixedCode }

  /* ------------------------------------------------------
     1. DOM REFERENCES
  ------------------------------------------------------ */
  const el = {
    navbar: document.getElementById("navbar"),
    navLinks: document.getElementById("navLinks"),
    hamburgerBtn: document.getElementById("hamburgerBtn"),

    startDebuggingBtn: document.getElementById("startDebuggingBtn"),
    tryExampleBtn: document.getElementById("tryExampleBtn"),

    languageSelect: document.getElementById("languageSelect"),
    loadExampleBtn: document.getElementById("loadExampleBtn"),
    copyCodeBtn: document.getElementById("copyCodeBtn"),
    clearCodeBtn: document.getElementById("clearCodeBtn"),

    codeInput: document.getElementById("codeInput"),
    editorGutter: document.getElementById("editorGutter"),
    charCount: document.getElementById("charCount"),
    analyzeBtn: document.getElementById("analyzeBtn"),

    resultsSection: document.getElementById("resultsSection"),
    resultsSummary: document.getElementById("resultsSummary"),
    resultsMeta: document.getElementById("resultsMeta"),
    resultsList: document.getElementById("resultsList"),

    fixCodeBtn: document.getElementById("fixCodeBtn"),
    fixStatusMessage: document.getElementById("fixStatusMessage"),

    comparisonBlock: document.getElementById("comparisonBlock"),
    originalCodeView: document.getElementById("originalCodeView"),
    fixedCodeView: document.getElementById("fixedCodeView"),
    copyFixedBtn: document.getElementById("copyFixedBtn"),

    statTotal: document.getElementById("statTotal"),
    statErrors: document.getElementById("statErrors"),
    statFixed: document.getElementById("statFixed"),
    statSession: document.getElementById("statSession"),
    statTotalHero: document.getElementById("statTotalHero"),
    statErrorsHero: document.getElementById("statErrorsHero"),
    statFixedHero: document.getElementById("statFixedHero"),
    resetStatsBtn: document.getElementById("resetStatsBtn"),

    historyFilter: document.getElementById("historyFilter"),
    historyList: document.getElementById("historyList"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),

    toast: document.getElementById("toast"),
  };

  /* ------------------------------------------------------
     2. UTILITIES
  ------------------------------------------------------ */

  /** Escape HTML to prevent XSS when displaying user code. */
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message, type = "default", duration = 3200) {
    el.toast.textContent = message;
    el.toast.className = "toast" + (type === "error" ? " toast-error" : type === "success" ? " toast-success" : "");
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.hidden = true; }, duration);
  }

  /** Safe localStorage wrapper — never throws, degrades gracefully. */
  const safeStorage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn("CodeFix: could not read localStorage key", key, e);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn("CodeFix: could not write localStorage key", key, e);
        showToast("Your browser storage is full or unavailable — history/stats won't be saved this time.", "error");
        return false;
      }
    },
  };

  function formatDateTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return isoString;
    }
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ------------------------------------------------------
     3. EXAMPLE CODE (each intentionally contains a bug)
  ------------------------------------------------------ */
  const EXAMPLES = {
    java:
`public class Main {
    public static void main(String[] args) {
        System.out.println("Hello World")
        int x = 5
        System.out.println(x);
    }
}`,
    python:
`def greet(name):
    print("Hello " + name)

def add(a, b)
    return a + b

if add(2, 3) > 4
    print("big")`,
    c:
`#include <stdio.h>

int main() {
    int a = 5
    printf("Value is %d\\n", a);
    return 0
}`,
    cpp:
`#include <iostream>
using namespace std;

int main() {
    int a = 10
    cout << "Value: " << a << endl;
    return 0;
}`,
    javascript:
`function greet(name) {
    console.log("Hello " + name)
    let total = (1 + 2;
    return total
}

greet("World"`,
    html:
`<!DOCTYPE html>
<html>
<head>
  <title>My Page</title>
</head>
<body>
  <h1>Welcome
  <p>This is a paragraph.</p>
  <div>
    <span>Unclosed span
  </div>
</body>
</html>`,
    css:
`body {
  background-color: #111
  color: white;
}

.card {
  padding: 10px;
  border-radius: 8px

.empty-selector {
}`,
  };

  /* ------------------------------------------------------
     4. ANALYZER ENGINE
     Each language analyzer returns an array of issue objects:
     {
       severity: 'error' | 'warning' | 'info' | 'success',
       title, line (number|null), why, fix, tip, correctedSnippet
     }
  ------------------------------------------------------ */

  function makeIssue({ severity, title, line, why, fix, tip, correctedSnippet }) {
    return {
      severity: severity || "info",
      title: title || "Issue",
      line: typeof line === "number" ? line : null,
      why: why || "",
      fix: fix || "",
      tip: tip || "",
      correctedSnippet: correctedSnippet || "",
    };
  }

  function getLines(code) {
    return code.replace(/\r\n/g, "\n").split("\n");
  }

  /** Checks whether brackets/parens/braces are balanced. Returns list of imbalance issues. */
  function checkBalancedSymbols(code, lines, openSym, closeSym, label) {
    const issues = [];
    let stack = [];
    let lineNo = 1;
    let inString = null; // ' or " or `
    let inLineComment = false;
    let inBlockComment = false;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      inLineComment = false;
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        const prev = line[ci - 1];

        if (inBlockComment) {
          if (ch === "/" && prev === "*") inBlockComment = false;
          continue;
        }
        if (inLineComment) continue;

        if (!inString && ch === "/" && line[ci + 1] === "/") { inLineComment = true; continue; }
        if (!inString && ch === "/" && line[ci + 1] === "*") { inBlockComment = true; continue; }

        if (inString) {
          if (ch === inString && prev !== "\\") inString = null;
          continue;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }

        if (ch === openSym) stack.push(li + 1);
        else if (ch === closeSym) {
          if (stack.length === 0) {
            issues.push(makeIssue({
              severity: "error",
              title: `Unexpected closing "${closeSym}"`,
              line: li + 1,
              why: `A "${closeSym}" was found without a matching "${openSym}" before it.`,
              fix: `Remove the extra "${closeSym}", or add a matching "${openSym}" earlier in the code.`,
              tip: `Count your ${label} pairs — every closing symbol needs an opening one before it.`,
            }));
          } else {
            stack.pop();
          }
        }
      }
    }

    if (stack.length > 0) {
      const line = stack[stack.length - 1];
      issues.push(makeIssue({
        severity: "error",
        title: `Unclosed "${openSym}"`,
        line,
        why: `A "${openSym}" was opened on line ${line} but never closed with a matching "${closeSym}".`,
        fix: `Add a matching "${closeSym}" to close this ${label}.`,
        tip: `Most editors highlight matching brackets — click right after the "${openSym}" to check.`,
      }));
    }
    return issues;
  }

  /** Detects unterminated string literals on a per-line basis (for languages where strings don't span lines). */
  function checkUnclosedStrings(lines, quoteChars = ['"', "'"]) {
    const issues = [];
    lines.forEach((line, idx) => {
      // Strip line comments naively for // style
      const codePart = line.split("//")[0];
      quoteChars.forEach((q) => {
        // Count unescaped quote occurrences
        let count = 0;
        for (let i = 0; i < codePart.length; i++) {
          if (codePart[i] === q && codePart[i - 1] !== "\\") count++;
        }
        if (count % 2 !== 0) {
          issues.push(makeIssue({
            severity: "error",
            title: "Unclosed string literal",
            line: idx + 1,
            why: `Line ${idx + 1} has an odd number of ${q} characters, which usually means a string was opened but never closed.`,
            fix: `Add the missing ${q} to close the string on this line.`,
            tip: "Strings must open and close with the same quote character on most languages.",
          }));
        }
      });
    });
    return issues;
  }

  /* -------------------- JAVA -------------------- */
  function analyzeJava(code) {
    const issues = [];
    const lines = getLines(code);

    if (!/class\s+\w+/.test(code)) {
      issues.push(makeIssue({
        severity: "error",
        title: "Missing class declaration",
        line: 1,
        why: "Java files must define at least one class, and the file's main logic usually lives inside one.",
        fix: `Wrap your code in a class, e.g. "public class Main { ... }".`,
        tip: "Every standalone Java program needs a public class whose name matches the file name.",
      }));
    }

    if (/class\s+\w+/.test(code) && !/public\s+static\s+void\s+main\s*\(/.test(code)) {
      issues.push(makeIssue({
        severity: "warning",
        title: "No main method found",
        line: null,
        why: "Java programs that run standalone need a \"public static void main(String[] args)\" entry point.",
        fix: `Add: public static void main(String[] args) { ... }`,
        tip: "Without a main method, this class can't be run directly — it can still be used as a library class though.",
      }));
    }

    issues.push(...checkBalancedSymbols(code, lines, "{", "}", "braces"));
    issues.push(...checkBalancedSymbols(code, lines, "(", ")", "parentheses"));
    issues.push(...checkUnclosedStrings(lines, ['"']));

    // Missing semicolons: a statement line that doesn't end with { } ; or a comment, and isn't a control-structure line.
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line) return;
      if (/^(\/\/|\/\*|\*)/.test(line)) return; // comments
      if (/[{};]\s*$/.test(line)) return;
      if (/^(if|else|for|while|switch|class|public|private|protected)\b.*[{)]\s*$/.test(line) && /[{(]$/.test(line)) return;
      if (/\)\s*$/.test(line) && /^(if|for|while|switch)\b/.test(line)) return; // condition header without brace on same line
      if (/^@/.test(line)) return; // annotations

      const looksLikeStatement =
        /^(System\.out\.print|int |double |float |long |short |boolean |char |String |var |return |[\w.\[\]]+\s*=\s*|[\w.]+\s*\()/.test(line);

      if (looksLikeStatement) {
        issues.push(makeIssue({
          severity: "error",
          title: "Missing semicolon",
          line: idx + 1,
          why: `Line ${idx + 1} looks like a statement but doesn't end with a semicolon. Java requires ";" at the end of every statement.`,
          fix: `Add ";" to the end of line ${idx + 1}: "${escapeHTML(line)};"`,
          tip: "A good rule: if the line does real work (a call, assignment, or declaration) and isn't a block header, it needs a semicolon.",
          correctedSnippet: line + ";",
        }));
      }
    });

    // Common println mistakes
    lines.forEach((raw, idx) => {
      if (/System\.out\.print[ln]*[^(]/.test(raw) && !/System\.out\.print[ln]*\s*\(/.test(raw)) {
        issues.push(makeIssue({
          severity: "warning",
          title: "Possible println syntax issue",
          line: idx + 1,
          why: "System.out.println / print must be followed by parentheses containing what you want to print.",
          fix: `Use the form: System.out.println("your text");`,
          tip: "println adds a new line after printing; print does not.",
        }));
      }
    });

    return issues;
  }

  /* -------------------- PYTHON -------------------- */
  function analyzePython(code) {
    const issues = [];
    const lines = getLines(code);

    // Missing colon after block-starting keywords
    const blockKeywords = /^(if|elif|else|for|while|def|class|try|except|finally|with)\b/;
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      if (blockKeywords.test(line)) {
        // strip trailing comment
        const noComment = line.split("#")[0].trimEnd();
        if (!noComment.endsWith(":")) {
          issues.push(makeIssue({
            severity: "error",
            title: "Missing colon",
            line: idx + 1,
            why: `Line ${idx + 1} starts a block ("${line.split(/\s/)[0]}") but doesn't end with a colon ":". Python requires a colon to start an indented block.`,
            fix: `Add ":" to the end of line ${idx + 1}: "${escapeHTML(noComment)}:"`,
            tip: "Every if / for / while / def / class / try line ends in a colon, followed by an indented block.",
            correctedSnippet: noComment + ":",
          }));
        }
      }
    });

    // Indentation: block-starter line followed by a line with same/less indentation that isn't blank/comment/another block-starter chain
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (blockKeywords.test(trimmed) && trimmed.endsWith(":")) {
        const currentIndent = line.match(/^\s*/)[0].length;
        // find next non-blank line
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length) {
          const nextIndent = lines[j].match(/^\s*/)[0].length;
          if (nextIndent <= currentIndent) {
            issues.push(makeIssue({
              severity: "error",
              title: "Indentation error",
              line: j + 1,
              why: `Line ${i + 1} opens a block ending in ":", so line ${j + 1} is expected to be indented further than it currently is.`,
              fix: `Indent line ${j + 1} (add spaces/a tab before it) so it sits inside the block started on line ${i + 1}.`,
              tip: "Python uses indentation instead of braces — be consistent with either spaces or tabs, never mix them.",
            }));
          }
        }
      }
    }

    // Mixed tabs and spaces
    const hasTabs = lines.some((l) => /^\t/.test(l));
    const hasSpaces = lines.some((l) => /^ {2,}/.test(l));
    if (hasTabs && hasSpaces) {
      issues.push(makeIssue({
        severity: "warning",
        title: "Mixed tabs and spaces",
        line: null,
        why: "Some lines are indented with tabs and others with spaces. Python can raise a TabError for inconsistent indentation.",
        fix: "Pick one style (spaces are the Python convention, 4 per level) and re-indent the whole file consistently.",
        tip: "Most editors can auto-convert tabs to spaces — turn this on to avoid the issue entirely.",
      }));
    }

    issues.push(...checkBalancedSymbols(code, lines, "(", ")", "parentheses"));
    issues.push(...checkBalancedSymbols(code, lines, "[", "]", "square brackets"));
    issues.push(...checkBalancedSymbols(code, lines, "{", "}", "curly braces"));
    issues.push(...checkUnclosedStrings(lines, ['"', "'"]));

    return issues;
  }

  /* -------------------- C -------------------- */
  function analyzeC(code) {
    return analyzeCFamily(code, "c");
  }

  /* -------------------- C++ -------------------- */
  function analyzeCpp(code) {
    return analyzeCFamily(code, "cpp");
  }

  function analyzeCFamily(code, variant) {
    const issues = [];
    const lines = getLines(code);

    if (!/#include\s*<\w+/.test(code)) {
      issues.push(makeIssue({
        severity: "warning",
        title: "No #include directives found",
        line: 1,
        why: variant === "c"
          ? "C programs almost always need at least stdio.h for input/output functions like printf/scanf."
          : "C++ programs almost always need at least iostream for input/output like cout/cin.",
        fix: variant === "c" ? `Add "#include <stdio.h>" at the top of the file.` : `Add "#include <iostream>" at the top of the file.`,
        tip: "#include lines bring in standard library functionality your code depends on.",
      }));
    }

    if (!/\bint\s+main\s*\(/.test(code) && !/\bvoid\s+main\s*\(/.test(code)) {
      issues.push(makeIssue({
        severity: "error",
        title: "Missing main() function",
        line: null,
        why: "Every standalone C/C++ program needs an entry point function called main().",
        fix: `Add: int main() { ... return 0; }`,
        tip: "main() is where program execution begins — without it, the program has nothing to run.",
      }));
    }

    issues.push(...checkBalancedSymbols(code, lines, "{", "}", "braces"));
    issues.push(...checkBalancedSymbols(code, lines, "(", ")", "parentheses"));
    issues.push(...checkUnclosedStrings(lines, ['"']));

    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line) return;
      if (/^(\/\/|\/\*|\*|#)/.test(line)) return;
      if (/[{};]\s*$/.test(line)) return;
      if (/^(if|else|for|while|switch)\b.*\)\s*$/.test(line)) return;

      const looksLikeStatement =
        /^(int |float |double |char |long |short |void |return |printf|scanf|cout|cin|[\w.\[\]]+\s*=\s*|[\w:]+\s*\()/.test(line);

      if (looksLikeStatement) {
        issues.push(makeIssue({
          severity: "error",
          title: "Missing semicolon",
          line: idx + 1,
          why: `Line ${idx + 1} looks like a statement but doesn't end with a semicolon, which ${variant === "c" ? "C" : "C++"} requires.`,
          fix: `Add ";" to the end of line ${idx + 1}: "${escapeHTML(line)};"`,
          tip: "Forgetting a semicolon is the single most common beginner mistake in C/C++.",
          correctedSnippet: line + ";",
        }));
      }
    });

    // printf/scanf format check (very basic — missing & in scanf for simple vars)
    lines.forEach((raw, idx) => {
      const scanfMatch = raw.match(/scanf\s*\(\s*"[^"]*"\s*,\s*([^)]+)\)/);
      if (scanfMatch) {
        const args = scanfMatch[1].split(",").map((a) => a.trim());
        args.forEach((arg) => {
          if (arg && !arg.startsWith("&") && !arg.includes("[")) {
            issues.push(makeIssue({
              severity: "warning",
              title: "Possible missing '&' in scanf",
              line: idx + 1,
              why: `scanf normally needs the memory address of a variable, written as "&${arg}", not just "${arg}".`,
              fix: `Change "${arg}" to "&${arg}" inside scanf on line ${idx + 1}.`,
              tip: "Arrays and strings are an exception — they usually don't need the '&'.",
            }));
          }
        });
      }
    });

    return issues;
  }

  /* -------------------- JAVASCRIPT -------------------- */
  function analyzeJavaScript(code) {
    const issues = [];
    const lines = getLines(code);

    issues.push(...checkBalancedSymbols(code, lines, "{", "}", "braces"));
    issues.push(...checkBalancedSymbols(code, lines, "(", ")", "parentheses"));
    issues.push(...checkBalancedSymbols(code, lines, "[", "]", "square brackets"));
    issues.push(...checkUnclosedStrings(lines, ['"', "'"]));

    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line) return;
      if (/^(\/\/|\/\*|\*)/.test(line)) return;
      if (/[{};,:]\s*$/.test(line)) return;
      if (/^(if|else|for|while|switch|function|try|catch|finally)\b.*[{(]\s*$/.test(line)) return;

      const looksLikeStatement =
        /^(const |let |var |return |console\.(log|error|warn)|[\w.$\[\]]+\s*=[^=]|[\w.$]+\s*\()/.test(line);

      if (looksLikeStatement) {
        issues.push(makeIssue({
          severity: "warning",
          title: "Missing semicolon",
          line: idx + 1,
          why: `Line ${idx + 1} looks like a complete statement without a trailing semicolon. JavaScript can often infer it (ASI), but relying on that can cause subtle bugs.`,
          fix: `Add ";" to the end of line ${idx + 1}: "${escapeHTML(line)};"`,
          tip: "Automatic Semicolon Insertion (ASI) doesn't always do what you expect — explicit semicolons are safer.",
          correctedSnippet: line + ";",
        }));
      }
    });

    // console.log without parentheses
    lines.forEach((raw, idx) => {
      if (/console\.log[^(]/.test(raw) && !/console\.log\s*\(/.test(raw)) {
        issues.push(makeIssue({
          severity: "warning",
          title: "Possible console.log syntax issue",
          line: idx + 1,
          why: "console.log must be called with parentheses containing what you want to print.",
          fix: `Use the form: console.log("your message");`,
          tip: "console.log(), console.error(), and console.warn() all need parentheses to actually run.",
        }));
      }
    });

    // Obvious undeclared-looking usage: using a variable name that's never declared with let/const/var/function/param
    const declared = new Set();
    const declRegex = /\b(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = declRegex.exec(code)) !== null) declared.add(m[1]);
    const paramRegex = /function\s*[\w$]*\s*\(([^)]*)\)/g;
    while ((m = paramRegex.exec(code)) !== null) {
      m[1].split(",").forEach((p) => { const n = p.trim().split("=")[0].trim(); if (n) declared.add(n); });
    }
    const knownGlobals = new Set(["console", "window", "document", "Math", "JSON", "Array", "Object", "String", "Number", "Boolean", "parseInt", "parseFloat", "setTimeout", "setInterval", "Promise", "Date", "fetch", "localStorage", "undefined", "NaN", "Infinity", "isNaN", "isFinite"]);
    const usageRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    const flagged = new Set();
    while ((m = usageRegex.exec(code)) !== null) {
      const name = m[1];
      if (declared.has(name) || knownGlobals.has(name) || flagged.has(name)) continue;
      if (["if", "for", "while", "switch", "catch", "function", "return"].includes(name)) continue;
      flagged.add(name);
      const lineIdx = code.slice(0, m.index).split("\n").length;
      issues.push(makeIssue({
        severity: "info",
        title: `Possibly undefined function "${name}"`,
        line: lineIdx,
        why: `"${name}" is called but CodeFix couldn't find a matching function/variable declaration in this file — it may be undefined, or defined elsewhere.`,
        fix: `Make sure "${name}" is declared (function ${name}() {...}) before it's used, or imported from another file.`,
        tip: "This check only looks within the pasted code, so built-ins from other files won't be flagged incorrectly if you know they exist elsewhere.",
      }));
    }

    return issues;
  }

  /* -------------------- HTML -------------------- */
  const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype"]);

  function analyzeHTML(code) {
    const issues = [];
    const lines = getLines(code);
    const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
    const stack = [];
    let m;

    while ((m = tagRegex.exec(code)) !== null) {
      const full = m[0];
      const name = m[1].toLowerCase();
      const attrs = m[2] || "";
      const isClosing = full.startsWith("</");
      const isSelfClosing = attrs.trim().endsWith("/") || VOID_TAGS.has(name);
      const lineNo = code.slice(0, m.index).split("\n").length;

      if (name === "!doctype") continue;

      if (isClosing) {
        if (stack.length === 0 || stack[stack.length - 1].name !== name) {
          const openIdx = stack.map((s) => s.name).lastIndexOf(name);
          if (openIdx === -1) {
            issues.push(makeIssue({
              severity: "error",
              title: `Unexpected closing tag </${name}>`,
              line: lineNo,
              why: `Found a closing tag </${name}> with no matching opening <${name}> tag before it.`,
              fix: `Remove </${name}>, or add a matching opening <${name}> tag earlier.`,
              tip: "HTML tags must open before they close, and close in the reverse order they were opened.",
            }));
          } else {
            // Unclosed tags between openIdx and top of stack
            for (let k = stack.length - 1; k >= openIdx; k--) {
              issues.push(makeIssue({
                severity: "error",
                title: `Unclosed tag <${stack[k].name}>`,
                line: stack[k].line,
                why: `<${stack[k].name}> was opened on line ${stack[k].line} but never properly closed before </${name}> appeared.`,
                fix: `Add a closing </${stack[k].name}> right before the </${name}> tag, or close tags in the correct nested order.`,
                tip: "Think of tags like stacked boxes — the last one opened should be the first one closed.",
              }));
            }
            stack.length = openIdx;
          }
        } else {
          stack.pop();
        }
      } else if (!isSelfClosing) {
        stack.push({ name, line: lineNo });
      }
    }

    stack.forEach((s) => {
      issues.push(makeIssue({
        severity: "error",
        title: `Unclosed tag <${s.name}>`,
        line: s.line,
        why: `<${s.name}> was opened on line ${s.line} but no closing </${s.name}> tag was found anywhere after it.`,
        fix: `Add a closing </${s.name}> tag.`,
        tip: "Every non-void HTML element needs a matching closing tag.",
      }));
    });

    if (!/<!DOCTYPE html>/i.test(code)) {
      issues.push(makeIssue({
        severity: "warning",
        title: "Missing <!DOCTYPE html>",
        line: 1,
        why: "Without a doctype, browsers may render your page in 'quirks mode', which can cause inconsistent styling.",
        fix: `Add "<!DOCTYPE html>" as the very first line of the file.`,
        tip: "Always start HTML5 documents with <!DOCTYPE html>.",
      }));
    }
    if (!/<html[\s>]/i.test(code)) {
      issues.push(makeIssue({ severity: "warning", title: "Missing <html> tag", line: null, why: "The document has no root <html> element wrapping its content.", fix: "Wrap your document in <html> ... </html>.", tip: "The <html> tag is the root of every HTML document." }));
    }
    if (!/<head[\s>]/i.test(code)) {
      issues.push(makeIssue({ severity: "info", title: "Missing <head> section", line: null, why: "The <head> section usually holds the title, meta tags, and linked stylesheets.", fix: "Add a <head> section containing at least a <title>.", tip: "Metadata like character encoding and page title belong in <head>." }));
    }
    if (!/<title[\s>]/i.test(code)) {
      issues.push(makeIssue({ severity: "info", title: "Missing <title> tag", line: null, why: "A page without a <title> shows a blank browser tab title.", fix: "Add <title>Your Page Title</title> inside <head>.", tip: "The title also matters for accessibility and search engines." }));
    }

    // Duplicate IDs
    const idRegex = /\bid\s*=\s*["']([^"']+)["']/g;
    const idMap = {};
    while ((m = idRegex.exec(code)) !== null) {
      const id = m[1];
      const lineNo = code.slice(0, m.index).split("\n").length;
      if (!idMap[id]) idMap[id] = [];
      idMap[id].push(lineNo);
    }
    Object.keys(idMap).forEach((id) => {
      if (idMap[id].length > 1) {
        issues.push(makeIssue({
          severity: "error",
          title: `Duplicate id "${id}"`,
          line: idMap[id][1],
          why: `The id "${id}" is used on lines ${idMap[id].join(", ")}. IDs must be unique within a page.`,
          fix: `Rename one of the duplicate ids, e.g. "${id}-2", to make each id unique.`,
          tip: "Duplicate IDs break CSS selectors, JavaScript's getElementById, and accessibility tools.",
        }));
      }
    });

    return issues;
  }

  /* -------------------- CSS -------------------- */
  function analyzeCSS(code) {
    const issues = [];
    const lines = getLines(code);

    issues.push(...checkBalancedSymbols(code, lines, "{", "}", "braces"));

    // Empty selectors
    const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRegex.exec(code)) !== null) {
      const selector = m[1].trim();
      const body = m[2].trim();
      const lineNo = code.slice(0, m.index).split("\n").length;
      if (!body) {
        issues.push(makeIssue({
          severity: "warning",
          title: `Empty rule for "${selector}"`,
          line: lineNo,
          why: `The selector "${selector}" has no declarations inside its braces, so it has no visual effect.`,
          fix: `Add at least one property, e.g. "${selector} { color: inherit; }", or remove the empty rule.`,
          tip: "Empty rules are harmless but usually mean unfinished styling.",
        }));
      }
    }

    // Missing semicolons inside declaration blocks (property: value without ; before next property or })
    // Find blocks
    let braceDepth = 0;
    let blockStart = -1;
    for (let i = 0; i < code.length; i++) {
      if (code[i] === "{") { braceDepth++; if (braceDepth === 1) blockStart = i + 1; }
      else if (code[i] === "}") {
        if (braceDepth === 1 && blockStart !== -1) {
          const block = code.slice(blockStart, i);
          checkCSSDeclarations(block, blockStart, code, issues);
        }
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    // Missing closing brace overall handled by checkBalancedSymbols already.

    return issues;
  }

  function checkCSSDeclarations(block, offset, fullCode, issues) {
    // Split on ; but keep track of last declaration without trailing ;
    const declLines = block.split("\n");
    let runningOffset = offset;
    for (let i = 0; i < declLines.length; i++) {
      const raw = declLines[i];
      const trimmed = raw.trim();
      const lineStartOffset = runningOffset;
      runningOffset += raw.length + 1;
      if (!trimmed) continue;
      if (trimmed.startsWith("/*") || trimmed.endsWith("*/")) continue;
      // A declaration line has a colon and should end with ; (unless it's the very last declaration before })
      if (/:/.test(trimmed) && !trimmed.endsWith(";") && !trimmed.endsWith("{") && !trimmed.endsWith("}")) {
        const isLastNonEmpty = declLines.slice(i + 1).every((l) => l.trim() === "");
        const lineNo = fullCode.slice(0, lineStartOffset).split("\n").length;
        issues.push(makeIssue({
          severity: isLastNonEmpty ? "warning" : "error",
          title: "Missing semicolon in CSS rule",
          line: lineNo,
          why: `The declaration "${trimmed}" doesn't end with a semicolon. CSS requires ";" between declarations (the last one in a block is often forgiven by browsers, but it's best practice to always include it).`,
          fix: `Add ";" to the end: "${escapeHTML(trimmed)};"`,
          tip: "Always terminate CSS declarations with a semicolon, even the last one in a block — it prevents bugs when you add more later.",
          correctedSnippet: trimmed + ";",
        }));
      }
    }
  }

  /* ------------------------------------------------------
     5. ANALYZER DISPATCH
  ------------------------------------------------------ */
  const ANALYZERS = {
    java: analyzeJava,
    python: analyzePython,
    c: analyzeC,
    cpp: analyzeCpp,
    javascript: analyzeJavaScript,
    html: analyzeHTML,
    css: analyzeCSS,
  };

  const LANGUAGE_LABELS = {
    java: "Java", python: "Python", c: "C", cpp: "C++",
    javascript: "JavaScript", html: "HTML", css: "CSS",
  };

  function buildFixedCode(code, issues) {
    // Apply simple line-level fixes where a correctedSnippet + line number is available.
    const lines = getLines(code);
    const applied = [...lines];
    issues.forEach((issue) => {
      if (issue.correctedSnippet && issue.line && issue.line >= 1 && issue.line <= applied.length) {
        const originalTrimmed = applied[issue.line - 1].trim();
        // Only replace if the corrected snippet is clearly an extension of the original trimmed line
        if (originalTrimmed && issue.correctedSnippet.startsWith(originalTrimmed)) {
          const indentMatch = applied[issue.line - 1].match(/^\s*/);
          const indent = indentMatch ? indentMatch[0] : "";
          applied[issue.line - 1] = indent + issue.correctedSnippet;
        }
      }
    });
    return applied.join("\n");
  }

  /* ------------------------------------------------------
     6. STATS
  ------------------------------------------------------ */
  function getStats() {
    return safeStorage.get(STORAGE_KEYS.STATS, { ...DEFAULT_STATS });
  }

  function updateStats(issueCount, fixCount) {
    const stats = getStats();
    stats.totalAnalyses += 1;
    stats.errorsDetected += issueCount;
    stats.fixesSuggested += fixCount;
    safeStorage.set(STORAGE_KEYS.STATS, stats);
    sessionAnalyses += 1;
    renderStats();
  }

  function renderStats() {
    const stats = getStats();
    el.statTotal.textContent = stats.totalAnalyses;
    el.statErrors.textContent = stats.errorsDetected;
    el.statFixed.textContent = stats.fixesSuggested;
    el.statSession.textContent = sessionAnalyses;

    el.statTotalHero.textContent = stats.totalAnalyses;
    el.statErrorsHero.textContent = stats.errorsDetected;
    el.statFixedHero.textContent = stats.fixesSuggested;
  }

  function resetStats() {
    safeStorage.set(STORAGE_KEYS.STATS, { ...DEFAULT_STATS });
    sessionAnalyses = 0;
    renderStats();
    showToast("Statistics have been reset.", "success");
  }

  /* ------------------------------------------------------
     7. HISTORY
  ------------------------------------------------------ */
  function getHistory() {
    return safeStorage.get(STORAGE_KEYS.HISTORY, []);
  }

  function addToHistory(entry) {
    const history = getHistory();
    history.unshift(entry);
    while (history.length > MAX_HISTORY_ITEMS) history.pop();
    safeStorage.set(STORAGE_KEYS.HISTORY, history);
    renderHistory();
  }

  function deleteHistoryItem(id) {
    const history = getHistory().filter((h) => h.id !== id);
    safeStorage.set(STORAGE_KEYS.HISTORY, history);
    renderHistory();
    showToast("History item deleted.");
  }

  function clearAllHistory() {
    safeStorage.set(STORAGE_KEYS.HISTORY, []);
    renderHistory();
    showToast("All history cleared.");
  }

  function renderHistory() {
    const filter = el.historyFilter.value;
    const history = getHistory().filter((h) => filter === "all" || h.language === filter);

    if (history.length === 0) {
      el.historyList.innerHTML = `<p class="empty-state">No analyses yet. Run your first analysis above to see it here.</p>`;
      return;
    }

    el.historyList.innerHTML = history.map((h) => `
      <div class="history-item" data-id="${h.id}">
        <div class="history-item-main">
          <div class="history-item-top">
            <span class="history-lang">${escapeHTML(LANGUAGE_LABELS[h.language] || h.language)}</span>
            <span class="history-date">${escapeHTML(formatDateTime(h.timestamp))}</span>
          </div>
          <span class="history-summary">${h.issueCount} issue${h.issueCount === 1 ? "" : "s"} found — ${escapeHTML(h.summary)}</span>
        </div>
        <div class="history-actions">
          <button class="btn btn-small history-open-btn" data-id="${h.id}">Open</button>
          <button class="btn btn-small btn-danger history-delete-btn" data-id="${h.id}">Delete</button>
        </div>
      </div>
    `).join("");

    el.historyList.querySelectorAll(".history-open-btn").forEach((btn) => {
      btn.addEventListener("click", () => openHistoryItem(btn.dataset.id));
    });
    el.historyList.querySelectorAll(".history-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteHistoryItem(btn.dataset.id));
    });
  }

  function openHistoryItem(id) {
    const history = getHistory();
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    el.languageSelect.value = entry.language;
    el.codeInput.value = entry.code;
    updateEditorChrome();
    renderResults(entry.language, entry.code, entry.issues || []);
    document.getElementById("editor").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Loaded from history.");
  }

  /* ------------------------------------------------------
     8. EDITOR CHROME (line numbers, char count)
  ------------------------------------------------------ */
  function updateEditorChrome() {
    const code = el.codeInput.value;
    const lineCount = code.length === 0 ? 1 : code.split("\n").length;
    const gutterLines = [];
    for (let i = 1; i <= lineCount; i++) gutterLines.push(i);
    el.editorGutter.textContent = gutterLines.join("\n");
    el.charCount.textContent = `${code.length} characters · ${lineCount} line${lineCount === 1 ? "" : "s"}`;
  }

  el.codeInput.addEventListener("scroll", () => {
    el.editorGutter.scrollTop = el.codeInput.scrollTop;
  });
  el.codeInput.addEventListener("input", debounce(updateEditorChrome, 60));

  /* ------------------------------------------------------
     9. RESULTS RENDERING
  ------------------------------------------------------ */
  const SEVERITY_LABEL = { error: "Error", warning: "Warning", success: "Success", info: "Info" };

  function renderResults(language, code, issues) {
    el.resultsSection.hidden = false;

    if (issues.length === 0) {
      el.resultsSummary.textContent = "No obvious issues detected";
      el.resultsMeta.textContent = LANGUAGE_LABELS[language] || language;
      el.resultsList.innerHTML = `
        <div class="result-card state-success">
          <div class="result-top">
            <span class="result-title"><span class="badge badge-success">Success</span> No obvious issues detected</span>
          </div>
          <div class="result-body">
            <p class="result-row"><span>CodeFix's static checks didn't find any of the common beginner mistakes it looks for. This does not guarantee your code is bug-free — logic errors and issues that only show up when the code actually runs can't be caught this way.</span></p>
          </div>
        </div>`;
      el.comparisonBlock.hidden = true;
      el.fixCodeBtn.hidden = true;
      el.fixStatusMessage.hidden = true;
      lastAnalysis = { language, code, issues, fixableIssues: [], fixedCode: null };
      return;
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const infoCount = issues.filter((i) => i.severity === "info").length;

    el.resultsSummary.textContent = `${issues.length} Issue${issues.length === 1 ? "" : "s"} Found`;
    el.resultsMeta.textContent = `${LANGUAGE_LABELS[language] || language} · ${errorCount} error${errorCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}, ${infoCount} info`;

    el.resultsList.innerHTML = issues.map((issue) => `
      <div class="result-card state-${issue.severity}">
        <div class="result-top">
          <span class="result-title">
            <span class="badge badge-${issue.severity}">${SEVERITY_LABEL[issue.severity] || "Info"}</span>
            ${escapeHTML(issue.title)}
          </span>
          ${issue.line ? `<span class="result-line">Line ${issue.line}</span>` : `<span class="result-line">Line not detected</span>`}
        </div>
        <div class="result-body">
          ${issue.why ? `<div class="result-row"><strong>Why?</strong><p>${escapeHTML(issue.why)}</p></div>` : ""}
          ${issue.fix ? `<div class="result-row"><strong>How to fix</strong><p>${escapeHTML(issue.fix)}</p></div>` : ""}
          ${issue.correctedSnippet ? `<div class="result-row"><strong>Corrected line</strong><div class="result-fix-code">${escapeHTML(issue.correctedSnippet)}</div></div>` : ""}
          ${issue.tip ? `<div class="result-row"><strong>Developer tip</strong><p>${escapeHTML(issue.tip)}</p></div>` : ""}
        </div>
      </div>
    `).join("");

    // ---- One-click "Fix Code" feature ----
    // Comparison view no longer opens automatically. Instead, if at least one
    // detected issue has a safe, reliable correction available, a prominent
    // "Fix Code" button is revealed; the corrected code is only generated
    // once the user actually clicks it.
    const fixableIssues = issues.filter((i) => i.correctedSnippet);
    el.comparisonBlock.hidden = true;
    lastAnalysis = { language, code, issues, fixableIssues, fixedCode: null };

    if (fixableIssues.length > 0) {
      el.fixCodeBtn.hidden = false;
      el.fixStatusMessage.hidden = true;
    } else {
      // Issues exist, but none of them can be safely auto-corrected.
      el.fixCodeBtn.hidden = true;
      showFixStatusMessage(
        "warning",
        "⚠ This issue cannot be automatically fixed. Please review the suggested explanation above."
      );
    }
  }

  /** Shows the small pill message under the results ("fixed successfully" / "can't auto-fix"). */
  function showFixStatusMessage(type, text) {
    el.fixStatusMessage.textContent = text;
    el.fixStatusMessage.className =
      "fix-status-message" +
      (type === "success" ? " fix-status-success" : type === "warning" ? " fix-status-warning" : "");
    el.fixStatusMessage.hidden = false;
  }

  /**
   * Handles a click on the "✨ Fix Code" button: applies the corrections
   * CodeFix is confident about, fills in the existing Code Comparison /
   * Suggested Fix area, and reports success (or a friendly limitation notice).
   */
  function handleFixCode() {
    if (!lastAnalysis || !lastAnalysis.fixableIssues || lastAnalysis.fixableIssues.length === 0) {
      showFixStatusMessage(
        "warning",
        "⚠ This issue cannot be automatically fixed. Please review the suggested explanation above."
      );
      el.comparisonBlock.hidden = true;
      return;
    }

    try {
      const fixedCode = buildFixedCode(lastAnalysis.code, lastAnalysis.fixableIssues);

      if (!fixedCode || fixedCode === lastAnalysis.code) {
        showFixStatusMessage(
          "warning",
          "⚠ This issue cannot be automatically fixed. Please review the suggested explanation above."
        );
        el.comparisonBlock.hidden = true;
        return;
      }

      lastAnalysis.fixedCode = fixedCode;
      el.originalCodeView.textContent = lastAnalysis.code;
      el.fixedCodeView.textContent = fixedCode;
      el.comparisonBlock.hidden = false;
      showFixStatusMessage("success", "✓ Code fixed successfully!");
      el.comparisonBlock.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (fixError) {
      console.error("CodeFix: error while generating fix:", fixError);
      showFixStatusMessage(
        "warning",
        "⚠ This issue cannot be automatically fixed. Please review the suggested explanation above."
      );
      el.comparisonBlock.hidden = true;
    }
  }

  function summarizeIssues(issues) {
    if (issues.length === 0) return "No issues found";
    const titles = issues.slice(0, 2).map((i) => i.title);
    const extra = issues.length > 2 ? ` (+${issues.length - 2} more)` : "";
    return titles.join(", ") + extra;
  }

  /* ------------------------------------------------------
     10. MAIN ANALYZE HANDLER
  ------------------------------------------------------ */
  function runAnalysis() {
    try {
      const language = el.languageSelect.value;
      const code = el.codeInput.value;

      if (!code || !code.trim()) {
        showToast("Paste or type some code before analyzing.", "error");
        return;
      }
      if (code.length > MAX_CODE_LENGTH) {
        showToast(`That's a lot of code! CodeFix analyzes up to ${MAX_CODE_LENGTH.toLocaleString()} characters at a time — try a smaller snippet.`, "error");
        return;
      }

      const analyzer = ANALYZERS[language];
      if (!analyzer) {
        showToast("Please select a valid language before analyzing.", "error");
        return;
      }

      let issues = [];
      try {
        issues = analyzer(code) || [];
      } catch (analyzerError) {
        console.error("CodeFix analyzer error:", analyzerError);
        issues = [makeIssue({
          severity: "info",
          title: "This code requires a real compiler/interpreter for complete verification",
          why: "CodeFix hit a pattern it couldn't fully parse with its lightweight static rules.",
          fix: "Try compiling or running this code with a real " + (LANGUAGE_LABELS[language] || language) + " toolchain for a complete check.",
          tip: "CodeFix focuses on common beginner mistakes, not full language parsing.",
        })];
      }

      // Sort: errors first, then warnings, then info
      const severityOrder = { error: 0, warning: 1, info: 2, success: 3 };
      issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      renderResults(language, code, issues);

      const fixCount = issues.filter((i) => i.correctedSnippet).length;
      updateStats(issues.length, fixCount);

      addToHistory({
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        language,
        code,
        issues,
        issueCount: issues.length,
        summary: summarizeIssues(issues),
        timestamp: new Date().toISOString(),
      });

      el.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (fatalError) {
      console.error("CodeFix fatal error during analysis:", fatalError);
      showToast("Something went wrong analyzing this code. Please try again with a smaller snippet.", "error");
    }
  }

  /* ------------------------------------------------------
     11. EVENT WIRING
  ------------------------------------------------------ */

  // Navbar / mobile menu
  el.hamburgerBtn.addEventListener("click", () => {
    const isOpen = el.navLinks.classList.toggle("open");
    el.hamburgerBtn.classList.toggle("open", isOpen);
    el.hamburgerBtn.setAttribute("aria-expanded", String(isOpen));
  });
  el.navLinks.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      el.navLinks.classList.remove("open");
      el.hamburgerBtn.classList.remove("open");
      el.hamburgerBtn.setAttribute("aria-expanded", "false");
    });
  });

  // Hero buttons
  el.startDebuggingBtn.addEventListener("click", () => {
    document.getElementById("editor").scrollIntoView({ behavior: "smooth", block: "start" });
    el.codeInput.focus();
  });
  el.tryExampleBtn.addEventListener("click", () => {
    loadExample();
    document.getElementById("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Editor toolbar
  function loadExample() {
    const language = el.languageSelect.value;
    el.codeInput.value = EXAMPLES[language] || "";
    updateEditorChrome();
    showToast(`Loaded a ${LANGUAGE_LABELS[language]} example with intentional bugs.`);
  }
  el.loadExampleBtn.addEventListener("click", loadExample);

  el.clearCodeBtn.addEventListener("click", () => {
    el.codeInput.value = "";
    updateEditorChrome();
    el.resultsSection.hidden = true;
    el.codeInput.focus();
  });

  function copyText(text, successMessage) {
    if (!text) {
      showToast("Nothing to copy yet.", "error");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMessage, "success"))
        .catch(() => fallbackCopy(text, successMessage));
    } else {
      fallbackCopy(text, successMessage);
    }
  }

  function fallbackCopy(text, successMessage) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(successMessage, "success");
    } catch (e) {
      showToast("Couldn't copy automatically — please copy manually.", "error");
    }
  }

  el.copyCodeBtn.addEventListener("click", () => copyText(el.codeInput.value, "Code copied to clipboard."));
  el.copyFixedBtn.addEventListener("click", () => {
    if (lastAnalysis && lastAnalysis.fixedCode) {
      copyText(lastAnalysis.fixedCode, "Fixed code copied to clipboard.");
    }
  });

  el.analyzeBtn.addEventListener("click", runAnalysis);
  el.fixCodeBtn.addEventListener("click", handleFixCode);

  el.languageSelect.addEventListener("change", () => {
    el.resultsSection.hidden = true;
  });

  // Stats
  el.resetStatsBtn.addEventListener("click", () => {
    if (confirm("Reset all CodeFix statistics? This cannot be undone.")) {
      resetStats();
    }
  });

  // History
  el.historyFilter.addEventListener("change", renderHistory);
  el.clearHistoryBtn.addEventListener("click", () => {
    if (confirm("Clear all analysis history? This cannot be undone.")) {
      clearAllHistory();
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (!ctrlOrCmd) return;

    if (e.key === "Enter") {
      e.preventDefault();
      runAnalysis();
    } else if (e.key.toLowerCase() === "l" && document.activeElement === el.codeInput) {
      e.preventDefault();
      el.codeInput.value = "";
      updateEditorChrome();
    } else if (e.shiftKey && e.key.toLowerCase() === "c") {
      // Only hijack when focus is inside the tool, to avoid breaking normal copy elsewhere
      if (document.activeElement === el.codeInput) {
        e.preventDefault();
        copyText(el.codeInput.value, "Code copied to clipboard.");
      }
    }
  });

  /* ------------------------------------------------------
     12. INIT
  ------------------------------------------------------ */
  function init() {
    updateEditorChrome();
    renderStats();
    renderHistory();

    // Nice starting point: preload a JS example so first-time visitors see something immediately.
    if (!el.codeInput.value) {
      // leave empty by default — placeholder guides the user; example loads on demand.
    }

    window.addEventListener("error", (e) => {
      console.error("CodeFix uncaught error:", e.error || e.message);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
