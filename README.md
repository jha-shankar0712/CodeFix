# CodeFix

**Find the bug. Understand the error. Fix your code.**

CodeFix is a beginner-friendly, 100% client-side static code analysis tool. Paste your code, pick a language, click **Analyze Code**, and get a plain-English breakdown of common mistakes — what's wrong, why it happens, and how to fix it.

No installs. No servers. No signup. No backend. Your code never leaves your browser.

---

## Features

- **Instant static analysis** for 7 languages: Java, Python, C, C++, JavaScript, HTML, CSS
- **Plain-English explanations** for every detected issue (error type, line number, cause, fix, tip)
- **Code comparison view** — your original code vs. a suggested fix, with one-click copy
- **Built-in example code** per language (each intentionally buggy, so you can try CodeFix immediately)
- **Session statistics** (total analyses, errors detected, fixes suggested) saved with `localStorage`
- **Analysis history** with language filtering, open/delete/clear controls
- **Keyboard shortcuts**: `Ctrl+Enter` analyze, `Ctrl+L` clear, `Ctrl+Shift+C` copy
- **Responsive, accessible, dark IDE-inspired UI** — works on desktop and mobile
- **No `eval()`, no code execution** — your code is only ever read as text, and safely HTML-escaped before display

---

## Technologies used

- HTML5
- CSS3 (custom properties, Grid, Flexbox — no framework)
- Vanilla JavaScript (ES6+, no frameworks, no build step)
- Google Fonts (JetBrains Mono + Inter) loaded via CDN link tags

No React, no Node.js, no backend, no database.

---

## Folder structure

```
CodeFix/
│
├── index.html      → Page structure: landing page, editor, results, history, about
├── style.css        → All styling (dark IDE theme, responsive layout, animations)
├── script.js         → All logic: analyzers, UI wiring, localStorage, keyboard shortcuts
└── README.md        → This file
```

---

## How the analyzer works

CodeFix does **not** compile or execute your code. It is a **static, rule-based analyzer** written in plain JavaScript that scans your code as text and looks for well-known patterns beginners tend to get wrong, such as:

- Unbalanced brackets/braces/parentheses (using a bracket-matching stack scan that ignores strings and comments)
- Unclosed string literals (odd number of quote characters on a line)
- Missing semicolons at the end of statement-like lines (Java, C, C++, JavaScript)
- Missing colons after Python block keywords (`if`, `for`, `while`, `def`, `class`, etc.)
- Indentation problems in Python (a block header not followed by a deeper-indented line)
- Missing `#include` directives and `main()` functions in C/C++
- Unclosed/mismatched HTML tags, duplicate `id` attributes, missing `<!DOCTYPE html>`/`<head>`/`<title>`
- Missing semicolons and empty rule blocks in CSS
- A handful of language-specific sanity checks (e.g. `scanf` without `&`, `println`/`console.log` without parentheses)

Each detected issue includes: an error type, a line number when detectable, a "why does this happen" explanation, a suggested fix, an optional corrected line, and a developer tip. When the analyzer builds a full corrected snippet, it also renders a full "Your Code vs. Suggested Fix" comparison.

**CodeFix is explicitly labeled as static code analysis / beginner error detection.** For anything it cannot confidently resolve, it shows: *"This code requires a real compiler/interpreter for complete verification."*

---

## Supported languages

| Language   | Checks include |
|------------|-----------------|
| Java       | Missing class/`main`, unbalanced `{}`/`()`, unclosed strings, missing semicolons, `println` issues |
| Python     | Missing colons, indentation errors, mixed tabs/spaces, unbalanced brackets, unclosed strings |
| C          | Missing `#include`/`main()`, unbalanced `{}`/`()`, missing semicolons, `scanf` `&` check |
| C++        | Same as C, adapted for `iostream`/`cout`/`cin` |
| JavaScript | Unbalanced `{}`/`()`/`[]`, unclosed strings, missing semicolons, `console.log` issues, possibly-undefined function calls |
| HTML       | Unclosed/mismatched tags, missing doctype/head/title, duplicate IDs |
| CSS        | Unbalanced braces, missing semicolons, empty rule blocks |

---

## Limitations

- CodeFix is **not a compiler or interpreter** — it cannot catch logic errors, runtime errors, or anything that only appears when code actually executes.
- Detection is pattern-based, not a full language parser, so unusual (but valid) code styles can occasionally trigger false positives, and some real errors may go undetected.
- Analysis is capped at ~20,000 characters per run to keep the browser responsive.
- All data (stats/history) is stored in your browser's `localStorage` — it is **not synced across devices** and will be lost if you clear your browser data.

For complete verification, always compile/run your code with a real language toolchain (`javac`, `python3`, `gcc`/`g++`, Node.js, a real browser, etc.).

---

## How to run locally

### Method 1 — Direct Browser

1. Locate the `CodeFix` folder on your computer.
2. Double-click `index.html` (or right-click → **Open with** → your browser).
3. The site opens directly — no server needed.

### Method 2 — VS Code Live Server

1. Open the `CodeFix` folder in VS Code (`File → Open Folder…`).
2. Install the **Live Server** extension (by Ritwick Dey) from the Extensions panel if you don't already have it.
3. Right-click `index.html` in the file explorer and choose **"Open with Live Server"**.
4. Your default browser opens automatically at something like `http://127.0.0.1:5500/index.html`, and the page auto-reloads whenever you save a file.

---

## How to open in VS Code

1. Open VS Code.
2. `File → Open Folder…` and select the `CodeFix` folder.
3. You'll see `index.html`, `style.css`, `script.js`, and `README.md` in the Explorer sidebar.

---

## How to use the application

1. Scroll to the **"Analyze your code"** section (or click **Start Debugging** on the landing page).
2. Choose a language from the dropdown.
3. Paste your code, or click **Load Example** to try a pre-built buggy snippet.
4. Click **Analyze Code** (or press `Ctrl+Enter`).
5. Review the results: each issue shows its type, line number, cause, fix, and a tip.
6. If a corrected snippet is available, scroll down to **Code Comparison** and click **Copy Fixed Code**.
7. Check the **Statistics** section to see your running totals, and **History** to revisit past analyses.

---

## Future improvements

- Real compiler/interpreter integration (e.g. via WebAssembly toolchains) for full verification
- AI-powered explanations for errors outside the static rule set
- User accounts with cloud-synced history across devices
- Support for more languages (TypeScript, Go, Rust, PHP, Kotlin, Swift)
- A CodeFix VS Code extension for inline, real-time analysis
- GitHub integration to analyze a repository's files directly

---

## GitHub upload instructions

1. Create a new repository on GitHub (e.g. named `codefix`), **without** a README (you already have one).
2. Open a terminal inside your local `CodeFix` folder.
3. Run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: CodeFix static code analyzer"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/codefix.git
   git push -u origin main
   ```
4. Refresh your GitHub repository page — your files should now be visible.
5. (Optional) Enable **GitHub Pages** in the repo's **Settings → Pages** tab, choosing the `main` branch and `/ (root)` folder, to get a free live link to your deployed site.

---

## License

Free to use, modify, and share for learning, portfolio, or coursework purposes......
