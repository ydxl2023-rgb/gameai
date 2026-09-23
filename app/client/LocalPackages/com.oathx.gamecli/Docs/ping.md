# PING

The first implemented command checks the real Unity Editor named-pipe bridge. It does not test JIRA, run gameplay validation, or guarantee that the Unity main thread is responsive.

## Install from Unity

Open **Tools > GameCLI > Window**, then click **Install GameCLI** (or **Reinstall GameCLI**). The window locates the source through Unity Package Manager, runs a Release build asynchronously and installs all required CLI files into `Library/GameCLI`. This requires a .NET 8 SDK or compatible newer SDK on PATH and currently supports the Windows Editor.

Source Project and Installed Executable are read-only labels displaying paths relative to the Unity project root. The window displays build output and errors. **Cancel** or closing the window cancels the current operation. The command toolbar has six pages: **Orchestrator**, **PM**, **Art**, **Development**, **Unity** and **QA**. Unity displays a command table with On, Command, Method, Route, Status and Description columns; other categories currently show their scope and unimplemented status. Ping is invoked from the terminal, not a panel button. Installation is project-local and does not change the system PATH or install AI skills.

From the Unity project root after installation:

```powershell
.\Library\GameCLI\GameCLI.exe unity --ping --project . --format json
```
## Command enablement

The first-column toggle in the Unity command table enables or disables PING immediately. It defaults to enabled. Disabled calls return `ok: false`, `error: "command_disabled"` and exit code 3. Re-enable the toggle to accept requests again; no CLI reinstall is required.

Preferences are stored in EditorPrefs separately for each user and project and survive Editor restart. These are local tool settings, not JIRA workflow state. Status displays Enabled/Disabled configuration, not a live connectivity test.

## Usage

Open `app/client` in Unity 2022.3.62f2 and allow package import/compilation to finish. The project manifest references the local Game CLI package. If Unity was already open, return to its window and refresh assets.

From the repository root:

```powershell
dotnet build app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI.sln -c Release
dotnet app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI/bin/Release/net8.0/GameCLI.dll unity --ping --project app/client
```

Append `--format json` for a single JSON result on stdout. Diagnostics go to stderr. With no `--project`, the CLI searches the current directory and its parents for a Unity project. `--help` prints usage. The first argument selects the command group. Unity options follow `unity`; `--ping`, `--project` and `--format` can appear in any order within that group. `GameCLI unity --help` shows Unity usage. Bare `ping` is no longer supported; `jira` is reserved for future implementation and currently returns an unknown-group error.

A successful response contains `ok: true`, `message: "pong"`, the actual project path, Unity version, Editor PID and UTC response time. Session tokens are never included in responses.

Exit codes: 0 = pong; 1 = timeout/disconnection; 3 = bridge rejected the request; 4 = invalid arguments; 5 = missing/invalid project or endpoint configuration. The overall connection/request timeout is five seconds.

## Implementation

- `Plugins/Unity/UnityPingCommand.cs`: arguments, output and exit codes.
- `Services/UnityBridgeClient.cs`: project discovery, endpoint validation and pipe connection.
- `Runtime/PipeProtocol.cs`: shared bounded UTF-8 JSON framing, linked into the console project.
- `Editor/Bridge/GameCliServer.cs`: Editor lifecycle and authenticated GET /ping handling.
- `Library/GameCLI/endpoint.json`: temporary connection metadata, regenerated per Editor session; not workflow state and never versioned.

The bridge uses a random per-session pipe name and token. It stops on assembly reload or Editor exit and skips asset import workers. It serves one bounded request per connection; interrupted and malformed requests do not stop subsequent clients. It can also run in an isolated batch-mode Editor for validation.

## Smoke validation

With the target Unity Editor running and the CLI built:

```powershell
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.Smoke/GameCLI.Smoke.csproj -c Release -- app/client app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/GameCLI/bin/Release/net8.0/GameCLI.dll
```

This executable checks real pong, argument failure, invalid tokens, unknown routes and recovery after a partial-frame disconnect. It is an executable smoke check, not a `dotnet test` project. Keep test output and isolated validation projects under ignored Artifacts directories.
