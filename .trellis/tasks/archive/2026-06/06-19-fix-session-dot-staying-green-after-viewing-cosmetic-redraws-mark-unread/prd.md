# Fix session dot staying green (unread) after viewing

Tracks GitHub issue #32.

## Problem
A live session the user already viewed, with no new messages, keeps showing the GREEN unread dot (`#73c991`) instead of slate idle (`#8a93a6`).

## Root cause (verified)
In `window.posse.onPtyData((id, data) => …)` (src/renderer/app.ts ~3951):
- Line ~3962: **every** PTY data chunk calls `sessionBusy.add(id)` — including purely cosmetic output (cursor moves, OSC title sequences, spinner redraws, a stray control byte). There is no filter for "substantive" output.
- Then the prompt-detection / idle-timeout branches mark an INACTIVE session unread: `sessionUnread.add(id)` at ~4034 (hasPrompt) and ~4050 (3s timeout).

Net: a viewed, quiet, inactive session that receives any trivial redraw byte flips busy→unread→green, even though nothing new was actually shown. `switchToSession` (~3310) clears unread on focus, but the next cosmetic redraw re-greens it.

## Fix
Only treat output as activity when it contains substantive visible content. At the top of the `if (sessionTitles.has(id))` block in `onPtyData` (~3958), before `sessionBusy.add(id)`:
- Strip ANSI CSI (`\x1b\[…`), OSC (`\x1b]…\x07`/ST), and other escape/control sequences from `data`, plus standalone control chars and whitespace.
- If the residual is empty (the chunk was pure cursor/OSC/redraw/whitespace), SKIP the busy/unread state mutation and the prompt/timeout status logic for this chunk — still do `termManager.write` (already done before the block) and still update `recentDataBuffer` so prompt detection across chunks stays intact. Do NOT `renderSessionList()` for a cosmetic-only chunk.
- Substantive chunks: unchanged behavior.

Keep the existing busy/waiting/unread/idle semantics otherwise. Active session still goes to idle (not unread) on focus — unchanged.

## Acceptance criteria
- [ ] A viewed, inactive session that only receives cosmetic redraws (cursor/OSC/spinner-stop) stays slate idle `#8a93a6`, does NOT turn green.
- [ ] A session that produces real new output while inactive still turns green (unread) — no regression.
- [ ] Busy (amber+pulse), waiting (red ⚠), and active-session idle behavior unchanged.
- [ ] `recentDataBuffer` still accumulates across chunks so multi-chunk prompt detection works.
- [ ] `npm run build:renderer` passes.

## Out of scope
- Reworking the whole unread model / per-line "seen" tracking. This is a targeted cosmetic-output filter.
