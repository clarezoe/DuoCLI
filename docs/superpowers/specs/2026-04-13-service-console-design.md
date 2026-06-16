# DuoCLI Fixed Service Console Design

Date: 2026-04-13

## Goal

Add a fixed "Service Console" page to the DuoCLI desktop app to manage the three services that ship with DuoCLI in one place:

1. `cc-connect`
2. `FRP`
3. The DuoCLI mobile remote service

`cc-connect` needs to support configuring the Feishu `app_id` and `app_secret`, and automatically restart to apply the changes after saving.

## Non-goals

- No "arbitrary script panel" or general-purpose script runner.
- No "Launch DuoCLI.app" button. Launching the app again while it's already running has no real value.
- Don't mix the service-control entry into the existing `AI` config page, to avoid semantic pollution.
- Don't turn it into a standalone system-settings window; keep all operations within the main UI's right sidebar.

## User experience

Add a `Services` tab to the right sidebar, at the same level as `Sessions / History / AI`.

The page contains 3 fixed cards:

### 1. cc-connect card

Displayed content:

- Current status: not installed / running / stopped / error
- Config file path
- Feishu `app_id`
- Feishu `app_secret`

Action buttons:

- `Start`
- `Stop`
- `Restart`
- `Save and Restart`

Interaction constraints:

- On page load, read and pre-fill the Feishu config from the current `cc-connect/config.toml`.
- `app_secret` uses a password input by default.
- On "Save and Restart," validate that both fields are non-empty before writing back to the config file.
- After a successful save, automatically restart `cc-connect` and refresh the status.

### 2. FRP card

Displayed content:

- Current status: running / stopped / error
- Config path `frp/frpc.toml`
- A note: "Used to expose local port 9800 to the public internet"

Action buttons:

- `Start`
- `Stop`
- `Restart`

Interaction constraints:

- Start and stop run via the existing scripts in the repo:
  - `frp/start-frp.sh`
  - `frp/stop-frp.sh`
- Status is determined by process probing, not by parsing script output text.
- If the 9800 service isn't running, keep the existing script behavior and let the main process return the failure info to the UI.

### 3. Mobile remote service card

Displayed content:

- Current status: running / stopped / error
- Current port, default `9800`
- Current LAN access address

Action buttons:

- `Restart`

Interaction constraints:

- The mobile remote service in the current repo is started by the main process; the service console mainly handles status display and restart.
- No "Stop" button, to avoid accidentally disabling a core desktop capability.

## Technical design

## 1. Renderer layer

Files involved:

- `src/renderer/index.html`
- `src/renderer/app.ts`
- `src/renderer/styles.css`

Changes:

- Add a `Services` tab and its content container.
- Add the forms and buttons for the 3 service cards.
- Add a unified status-refresh function that actively fetches the latest status when switching to the `Services` tab.
- All button actions call the main process via the IPC API exposed by preload; never run system commands directly.

## 2. Preload

Files involved:

- `src/preload/index.ts`

New APIs:

- `serviceConsoleGetState()`
- `serviceConsoleControl(service: string, action: string)`
- `ccConnectGetConfig()`
- `ccConnectSaveConfig(config)`

Principles:

- The renderer never touches the file system or subprocesses directly.
- All return values keep a clear structure, so the renderer doesn't have to guess at error strings.

## 3. Main process

Files involved:

- `src/main/index.ts`
- `src/main/cc-connect-manager.ts`
- Optionally a new `src/main/service-console.ts`

### 3.1 cc-connect

Extend `CcConnectManager` with:

- Reading the Feishu config from `cc-connect/config.toml`
- Updating `app_id` / `app_secret`
- Providing start / stop / restart / status interfaces

Implementation constraints:

- Read the original file first, then do a minimal text replacement; don't rewrite the whole TOML structure.
- Only update the `[projects.platforms.options]` section corresponding to `type = "feishu"` under `[[projects.platforms]]`.
- If the Feishu config section doesn't exist, raise an error; automatic TOML-structure repair is out of scope for this requirement.

### 3.2 FRP

Add fixed control logic to the main process:

- Start: run `frp/start-frp.sh`
- Stop: run `frp/stop-frp.sh`
- Restart: stop, then start
- Status: determined via `pgrep -f "frpc.*frpc.toml"`

Implementation constraints:

- The start script must run non-blocking, because `start-frp.sh` holds `frpc` in the foreground.
- The main process returns a structured result: `ok`, `status`, `message`.
- Don't treat script output as the source of truth for status; use it only as supplementary error info.

### 3.3 Mobile remote service

Reuse the existing remote-service capability in the main process:

- Query the current listening port and LAN address
- Provide a restart method

Implementation approach:

- Prefer reusing the existing `remote-server.ts` instance and state.
- If the current implementation has no explicit restart entry point, add a controlled restart wrapper in the main process rather than restarting the app on the renderer side.

## State model

The service console returns the following unified structure:

```ts
type ServiceStatus = {
  id: "cc-connect" | "frp" | "remote-server";
  title: string;
  installed?: boolean;
  running: boolean;
  statusText: string;
  detail?: string;
};
```

Where:

- `cc-connect` additionally carries the Feishu config and config path
- `frp` additionally carries the script path and config path
- `remote-server` additionally carries the port and LAN address

## Error handling

- On config save failure, keep the user's input; don't clear the form.
- When `cc-connect` isn't installed, don't block viewing the config, but disable the start-related buttons.
- On `FRP` start failure, show the script's stderr or a timeout error.
- On mobile remote service restart failure, show the error info returned by the main process.

## Testing and verification

At minimum, cover the following:

1. `cc-connect` config is read correctly and the page pre-fills `app_id` and `app_secret`
2. After modifying the Feishu config, the corresponding fields in `config.toml` are replaced correctly
3. After clicking "Save and Restart," the `cc-connect` process is restarted and the status refreshes
4. The two `FRP` states (running and not running) are identified correctly
5. After clicking `FRP` Start / Stop / Restart, the status changes correctly
6. The mobile remote service card shows the current access address and port
7. After restarting the mobile remote service, the page can fetch a usable address again

Run-verification requirements:

- Run at least one desktop build or dev launch to confirm no compilation errors in renderer or main
- Manually verify `cc-connect` Save and Restart at least once
- Manually verify `FRP` start/stop at least once

## Phased implementation suggestion

1. First add the service-control APIs in the main process and preload
2. Then add the renderer's `Services` tab UI
3. Finally do integration testing and status refresh

This avoids writing the UI first and then finding the main-process state model is unstable.
