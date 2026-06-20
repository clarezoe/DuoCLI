# Show all agent sessions for a newly added folder

## Problem
After adding a folder and clicking Refresh, the agent (Claude/Codex) sessions inside it don't appear in the Projects list — the folder shows but is empty.

## Root cause (verified)
`buildProjectsList` (src/main/index.ts) sources sessions from `discoverClaudeSessions` / `discoverCodexSessions`, each of which gathers ALL on-disk sessions, sorts by mtime DESC, and keeps only the newest `MAX_FILES = 300` GLOBALLY (index.ts ~1005, ~1084). The user has ~1094 Claude jsonl files across 36 project dirs. A newly added folder whose sessions are older than the 300 globally-newest gets entirely cut, so the folder renders empty even though its sessions exist on disk.

The cap is global, not per-folder. `extraFolders` only guarantees the folder appears as an (empty) bucket — it does not pull that folder's sessions past the cap.

## Fix
Guarantee per-folder coverage for explicitly tracked folders (the `extraFolders` passed to `projects:list`), independent of the global cap.

Approach (in src/main/index.ts):
- `buildProjectsList(extraFolders)`: after the global discovery + bucketing, for EACH folder in `extraFolders`, ensure its Claude and Codex sessions are present:
  - Claude: scan that folder's encoded dir `~/.claude/projects/<cwd-with-every-non-alnum→'-'>/` directly for `*.jsonl`, newest first, up to `PROJECTS_MAX_SESSIONS_PER_AGENT` (50). Build `DiscoveredSession`s (same shape/title resolution as `discoverClaudeSessions` — reuse the title cache/`resolveClaudeTitle` path; factor a helper if needed). Merge into the bucket for that cwd, de-duplicating by session id (don't double-add ones already discovered globally).
  - Codex: Codex is date-bucketed, not cwd-bucketed. Reuse the existing per-cwd Codex lookup that `listCodexSessions(abs)` / the `claude:list-sessions`-style handler already implements (index.ts ~1718 area reads a specific cwd). Pull that folder's Codex sessions (cwd matched from `session_meta`), up to 50, merge + dedupe by id.
- De-dup rule: key by agent + session id; a folder-scoped session already present from the global pass must not create a duplicate row.
- Keep the global discovery as-is for the broad recent list; the per-folder pass only FILLS IN missing sessions for tracked folders.

Prefer reusing existing helpers (`encodeClaudeProjectDir`-equivalent, `getCachedClaudeTitle`, `resolveClaudeTitle`, `listCodexSessions`) over duplicating logic.

## Acceptance criteria
- [ ] Add a folder that has only OLD Claude sessions (outside the global newest-300) → after Refresh, those sessions show under the folder, grouped by agent.
- [ ] Same for a folder with old Codex sessions.
- [ ] No duplicate rows for sessions that were already visible via the global pass.
- [ ] Per-agent cap (50) still applies per folder; folders with >50 show the newest 50.
- [ ] No significant perf regression for users with many folders (per-folder scan is bounded to the tracked folders + 50 files each).
- [ ] `npm run build:main` passes.

## Out of scope
- Raising/removing the global 300 cap (perf). The fix is targeted per-folder coverage.
- Pagination / "load more" UI.
