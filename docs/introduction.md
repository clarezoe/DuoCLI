# Posse Project Introduction (updated 2026-02-17)

> This is the project introduction page (the long-term maintained version).

## In one sentence

Posse is a multi-terminal manager for the age of AI coding: the same terminal session you run on your computer can be viewed and typed into from your phone in real time.

## Latest capabilities

- **Two-way sync of the same session across phone and computer**: not screen mirroring, not a new SSH connection — session context is never lost
- **Three-color status lights synced across devices**: busy, awaiting confirmation, and read states mean the same thing on desktop and mobile
- **Visual configuration for loop mode**: save-and-start, quick stop, and auto-approve permission prompts
- **iOS PWA stability improvements**: auto-recovery from black screens; terminals are automatically rebuilt and replayed after returning from the background
- **Mobile usability upgrades**: Tab shortcut, auto-fill the file path after upload, and renamable titles

## Who it's for

- Developers running multiple terminal sessions at once (Claude Code / Codex / Gemini / Kimi, etc.)
- People who often step away from their desk but don't want the AI idling while it waits for confirmation
- Anyone who needs an AI-assisted development workflow that can be rolled back, traced, and archived

## Related reading

- [README (full features and install guide)](../README.md)

---

# Everyone says Claude Code is great, but it's really hard to use (legacy long read)

> **Posse — the multi-CLI power tool.** I was driven to write a tool myself.

---

## First, a rant

It's 2026 and AI coding assistants are everywhere. Claude Code, Codex, Gemini CLI, Kimi, Kiro, Cursor, Antigravity… they all claim to be great, they all have something going for them, but none of them makes my life easy.

Last week these tools gave me a headache, so let me go through them one by one.

### Cursor: nice, but heavy and pricey

Cursor really is the smoothest to use — great IDE integration, and editing code feels slick. But — **it's heavy and expensive.** The IDE itself eats resources, the monthly fee is what it is, and over the long run it adds up. And you can't use your own API key and model; you can only use what it gives you. Want to switch to something cheaper or local? No.

### Claude Code: powerful, but genuinely hard to use

Everyone says Claude Code is the strongest coding AI, and the code quality really is excellent. But it's just a single command-line window! It's great for big tasks — toss in a requirement and it bangs out the work. But what about small tasks? Tweak a style, adjust some spacing, change a color — every time you have to fight with the terminal.

And you can't click the file paths in the terminal. The AI says "I changed `src/components/Header.vue`" and you want to see what it changed — but you don't know VIM, the path isn't clickable, and you have to dig through directories in the file explorer yourself. **Digging through folders to find files is just too primitive.**

### Codex: decent at debugging, but slow and expensive

Codex's debugging ability really is solid; it pinpoints problems pretty accurately. But it's slow and expensive — I can brew a cup of coffee in the time it takes to finish a task.

### Kiro: free credits, but inconvenient

Kiro has a free tier, which is fine for grabbing freebies. But it's not very convenient to use; something always feels off.

### Kimi: bought a subscription, may as well use it

I bought a Kimi subscription, so I may as well use it. But it can't coordinate with the other tools — it's yet another standalone window.

### Antigravity: nice UI, the rest not so much

Antigravity's interface looks pretty good, but beyond the UI its capabilities are fairly average.

### OpenCode: too clumsy, worse than the CLI

OpenCode's idea is good, but in practice it's too clumsy — its comprehension and code quality both fall short, worse than just using Claude Code's command line directly.

---

## Then there's the terminal itself

Setting these AI tools aside, **the terminal itself has a pile of maddening issues:**

**Multitasking is a pain.** Using Claude, Codex, and Gemini at once means opening three terminal windows. The tab bar is all "zsh" and you can't tell which is which when you switch. Want a new session? You have to cd into the project directory and type the command all over again.

**Colors can't be changed.** Want to color-code different tasks? Can't be done. The three terminal windows look identical — all white text on black.

**Images can't be pasted.** This one is the most infuriating. Someone sends you a bug screenshot on WeChat, or you take a screenshot yourself and want to show the AI — **sorry, the terminal doesn't support pasting images.** You have to save the image to a file first, then manually type the file path. It's 2026 and you can't even Ctrl+V an image — is that reasonable?

**Rollback is a mystery.** You had the AI refactor a module, ran it, and found it broke. Want to revert? The AI changed a dozen files and you can't remember what they looked like before. `git stash`? That got overwritten by later operations long ago. Every rollback is like opening a blind box — you have no idea which state you ended up restoring to.

**File paths can't be clicked.** The AI prints a bunch of file paths and you want to open one? Sorry, this is a terminal, not a browser. If you don't know VIM, you have to dig through Finder layer by layer yourself.

**YOLO-mode flags are impossible to remember.** Claude's full-auto mode needs `--dangerously-skip-permissions`, Codex needs `--full-auto`, Gemini and Kimi need `--yolo`… every time you have to dig through the docs to look up the flags. Exhausting.

**Configuring API keys over and over.** You've already set up Claude's API key on the machine, then you install Codex and set it up again, and now a new tool comes along and you have to set it up yet again…

---

## A tool born out of frustration

I'm a so-so programmer; my daily routine is to tweak something, check the result, and roll back if it doesn't work. After months of being tormented by the stuff above, I decided — **I'll write my own and fix everything that bugs me.**

That's Posse.

![Posse main UI](images/main-ui.png)

In one sentence: **a multi-terminal manager designed for the age of AI coding.** Not just another terminal emulator, but something purpose-built to solve all the pain points of "running AI coding assistants from the command line."

The core idea is simple: **handle everything with one click.**

---

## What it solves

### One-click multitasking — goodbye, window hell

One window manages all your AI terminals. Pick a working directory, a preset command, and a color scheme, then click "+ New Terminal" — Claude, Codex, Gemini, Kimi, as many as you want, all in one interface.

Each terminal **auto-generates a title** based on its content, like "Claude: refactor login module" or "Codex: add unit tests." No more guessing at a row of "zsh."

- 6 built-in color schemes (VS Code Dark / Monokai / Dracula / Solarized Dark / One Dark / Nord) — different colors for different tasks, distinguishable at a glance
- Terminals you're not using can be "archived"; the process isn't killed and can be restored anytime
- Zero-config reuse of the API keys already on your machine — no need to configure them again

### One-click YOLO — full-auto mode without memorizing flags

Claude's full-auto needs `--dangerously-skip-permissions` (who can remember a flag that long?), Codex needs `--full-auto`, Gemini and Kimi need `--yolo`…

In Posse, just pick from the dropdown:

![Full-auto mode selection](images/yolo-mode.png)

Every AI tool has a "normal" and a "full-auto" option. Pick "Claude (auto)" and the flags are added for you — one click and you're off. No more digging through docs for flags.

### One-click image paste — you can paste screenshots into the terminal now

**I think this feature is the most practical.**

One of the most painful things about running AI coding assistants in a terminal is: **you can't paste images.** A coworker sends a bug screenshot on WeChat and you want the AI to look at it — sorry, the terminal doesn't support it. You have to save the image to a file first, find a place to store it, then manually type the file path for the AI.

Posse solves this directly. **Ctrl+V / Cmd+V, paste it straight in.** A screenshot copied from WeChat, a system screen capture, an image copied from the browser — just paste it in, and Posse automatically saves it to a temp file and sends the path to the terminal.

It's 2026 — pasting an image shouldn't be this much trouble.

### One-click rollback — a time machine, so breaking things isn't scary

This is my favorite feature.

Before each AI code change, Posse **automatically creates a Git snapshot.** You can:

- See which files each snapshot changed
- Expand the diff of each file (with color highlighting)
- **Restore file by file** — roll back just one file
- **Undo this change** — roll back all files recorded in this snapshot
- **Restore to this moment** — restore the entire project to its full state at a given snapshot (the time machine)

![Snapshots and diff view](images/snapshot.png)

Undone/restored snapshots are shown with strikethrough, so you can tell at a glance which history has already been rolled back.

Snapshots live on a separate Git orphan branch (`_posse_snapshots`), so they **never pollute your project's commit history.** A lifesaver for a so-so programmer.

### One-click links — open file paths directly

File paths in terminal output automatically become **clickable links.**

Whether it's an absolute path `/Users/xxx/src/App.vue`, a relative path `pages/index/index.vue`, or even an alias path like `@/components/Header.vue` — click it to open it directly in your editor.

No more digging through Finder. Right-click to switch the default editor.

### Zero config — API key auto-discovery

Posse automatically scans for AI tool configs already on your machine:

![AI config panel](images/ai-config.png)

`~/.claude`, `~/.codex`, `~/.gemini`, API keys in environment variables… all auto-discovered, no need to configure them again.

Click "Scan and Test" to auto-detect and verify, then pick one that works.

---

## How to use it

### Download directly

Go to [Releases](https://github.com/saddism/Posse/releases) to download an installer:

- **macOS** — a `.dmg` file; open it and drag into Applications. If you see "cannot verify developer" on first launch, right-click the app → Open
- **Windows** — an `.exe` installer; double-click to install. If SmartScreen warns you, click "More info" → "Run anyway"

### Build from source

```bash
git clone https://github.com/saddism/Posse.git
cd Posse
npm install
npm run rebuild
npm start
```

After launching:
1. Choose a working directory
2. Choose a preset command (Claude / Codex / Gemini / Kimi / empty terminal; options with the "auto" suffix append the flags automatically)
3. Choose a color scheme
4. Click "+ New Terminal"

That simple.

---

## Tech stack

Electron + node-pty + xterm.js + TypeScript + esbuild

The project structure is clean — PRs welcome.

---

## Finally

This tool was forced into existence by all sorts of frustrations.

Everyone says Claude Code is great, and I think so too. But great is great, and hard-to-use is hard-to-use. Since no one was solving these pain points, I did it myself.

If you also use multiple AI coding tools at once, or have been tormented by the terminal's various user-hostile experiences, give Posse a try.

**GitHub:** https://github.com/saddism/Posse

If you find it useful, give it a Star. It's free anyway.
