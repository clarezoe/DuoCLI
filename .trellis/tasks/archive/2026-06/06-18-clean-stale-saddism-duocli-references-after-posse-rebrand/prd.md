# Clean stale saddism/DuoCLI references after Posse rebrand

## Goal
The project was rebranded DuoCLI → Posse and migrated from `saddism/DuoCLI` to `Fei2-Labs/posse`. Stale references remain in code/docs. Fix the user-facing ones; leave intentional/historical ones untouched.

## Scope — FIX

### Bugs (user-facing, wrong target)
- `src/renderer/app.ts` (~line 4048): in-app "GitHub" link `openUrl('https://github.com/saddism/DuoCLI')` → `https://github.com/Fei2-Labs/posse`.
- `docs/introduction.md` (~181, 189, 222): `https://github.com/saddism/Posse...` (wrong owner) → `https://github.com/Fei2-Labs/posse...` (Releases URL, git clone URL, GitHub link).

### Brand consistency
- `electron-builder.yml` (line 2): `productName: DuoCLI` → `Posse`. (Active build config lives in package.json `build.productName: Posse`; this yml is likely stale/unused, but align it.)
- `.github/workflows/build.yml` (~line 70): release-notes heading `## DuoCLI — ...` → `## Posse — ...`.
- `mobile/client/app.js` (line 1): header comment `DuoCLI Mobile PWA` → `Posse Mobile PWA`.
- `frp/README.md`, `frp/start-cloudflared.sh`, `frp/status-cloudflared.sh`: replace user-facing "DuoCLI 桌面应用" / brand mentions with "Posse". Keep any literal filenames that actually exist on disk unchanged.

## Scope — DO NOT TOUCH (intentional / historical)
- `scripts/version-mac-app.js` (`legacyAppName = 'DuoCLI'`) — handles old-name bundles during rebrand; intentional.
- `scripts/rename-to-posse.sh` — the migration script; references old name by design.
- `.gitignore` (`!frp/DuoCLI-远程启动.scpt`) — matches an actual filename; renaming the file is out of scope.
- `.trellis/` archived tasks, handoffs, journal, and `CHANGELOG.md` — historical records, do not rewrite.
- `src/renderer/app.ts` internal comments referencing "CLOSED DuoCLI session/record" — concept naming, not user-facing; leave.

## Out of scope
- The GitHub "N commits ahead of saddism/DuoCLI:main" banner — comes from the fork-network relationship, not fixable in this repo. Requires GitHub Support to detach the fork (or recreating the repo as non-fork). Documented here for the user; no code action.

## Acceptance criteria
- [ ] In-app GitHub link and docs URLs point to `Fei2-Labs/posse`.
- [ ] No user-facing "DuoCLI" brand string in the FIX-scope files (comments/headings updated to Posse).
- [ ] Intentional/historical references untouched.
- [ ] `npm run build:renderer` passes; app still builds.
