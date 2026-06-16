# Changelog

## v1.1.0 — Devin multi-account management & smart account switching (2026-06-05)

### New features

#### Devin account manager (sidebar "👤 Devin" tab)
- **Multi-account management**: add/remove Devin accounts and manage several at once
- **One-click switch**: click the "Switch" button next to any account to log in automatically and write the credentials
- **Quota query**: shows each account's daily/weekly quota balance (D/W percentages)
- **Plan detection**: automatically detects Pro Trial / Pro / Free / Teams / Enterprise plans
- **Status monitoring**: green/red/gray dots indicate account status (healthy/error/not logged in)
- Data storage reuses `~/.session-sync-manager/accounts.json`, interoperable with the session-sync tool

#### Smart error detection & auto-recovery (Devin terminals only)
- **Auto-switch on hard rate limits**: when the following errors are detected, automatically switch accounts in the background and send "continue" to resume the session:
  - `quota exhausted` / `usage is exhausted` (daily/weekly quota used up)
  - `overall message rate limit` (account-level hard limit)
  - `Permission denied ... rate limit` (permission-level rate limiting)
- **Auto-wait on soft rate limits**: when a temporary `rate limit` is detected, wait 8 seconds and then automatically send "continue"
- **Device fingerprint rotation**: rotate `installation_id` on each switch to avoid cross-account rate-limit correlation
  - Rotation paths: `~/.local/share/devin/cli/installation_id` and `cli-next/installation_id`
- **Triple-layer safety net**: internal rotation in `auth-cli.mjs` → DuoCLI IPC fallback rotation → direct rotation on PTY auto-switch
- **Smart cooldown**: a cooldown applies on both successful and failed switches, preventing resource waste from rapid retries

#### Session resume improvements
- Automatically capture the `--resume` flag when a terminal exits, saving it to the closed-session list
- View closed sessions in the sidebar with one-click resume of the last session

### Improvements

- Fixed an issue where the macOS Dock launch PATH didn't include `~/.local/bin`; now calls `session-sync` via an absolute path
- Subprocess management improvements: `stdio: 'ignore'` + `unref()` to prevent pipe blocking and resource leaks
- A visible terminal hint on switch failure (`⚠️ [DuoCLI] Auto account-switch failed`) instead of failing silently
- Auto-retry timers are now part of the session lifecycle and are cleaned up automatically on destroy
- Deduplication: `rotateDevinInstallationId` consolidated into a single export in pty-manager.ts

### Technical details

- Authentication operations run through the `auth-cli.mjs` subprocess, reusing the Windsurf/Codeium login protocol
- No plaintext passwords are stored locally in DuoCLI; passwords are passed via IPC to the subprocess only for a one-time login
- Account lists and quota info are fetched quickly by reading `accounts.json` directly, without invoking a subprocess each time

### Known limitations

- Devin's `sessions.db` (172MB) is not yet cleaned up on switch; rotation may be considered in the future
- Only Devin CLI accounts are supported; direct management of Windsurf/Cascade accounts is not yet available
