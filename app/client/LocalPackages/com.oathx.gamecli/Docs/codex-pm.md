# Codex PM read-only analysis

This first integration runs an actual Codex App Server from the .NET 8 CLI. It creates a PM conversation, supplies the PM/common/JIRA skills, streams progress, requests structured output and validates the final draft. It does not create JIRA issues, approve requirements or schedule the other roles.

## Setup and usage

Install Codex CLI and sign in using its own login flow. Confirm `codex login status`. GameCLI reuses the Codex process environment and configuration; JIRA credentials are separate and are not sent to the model. Set `--codex <absolute codex.exe path>` if Codex is not on PATH. The tested local protocol version is `codex-cli 0.154.0-alpha.6.2`; App Server is evolving, so rerun integration tests when upgrading.

Build the solution, or use **Reinstall GameCLI** in the Unity window to update `Library/GameCLI/GameCLI.exe`. From the repository root, the installed executable can be used as follows:

```powershell
./app/client/Library/GameCLI/GameCLI.exe pm --analyze --project . --prompt "主菜单显示配置中的版本号，给出开发和 QA 任务，无需美术。" --format json
```

For a longer requirement, use `--prompt-file <UTF-8 file>` instead of `--prompt`. A requirement is limited to 64 KiB. `--project` accepts an existing working directory; skills are discovered from that directory and its ancestors. For a different workspace, supply `--skills <package game-cli directory>` explicitly.

Optional flags: `--model <model ID>` (otherwise use Codex configuration), `--timeout <1..3600 seconds>` (default 300), `--format human|json` (default human). Ctrl+C cancels the operation. Arguments use `ProcessStartInfo.ArgumentList`; no shell command strings are constructed.

In JSON mode stdout contains exactly one final JSON object. Progress, including incremental agent messages, goes to stderr:

```powershell
./app/client/Library/GameCLI/GameCLI.exe pm --analyze --project . --prompt-file ./requirement.txt --format json > ./analysis.json
```

The response includes the Codex thread/turn IDs, input SHA-256, UTC start/end timestamps and validated PM analysis. The analysis includes schema version, trace/execution IDs, null issue key, status, specification, tasks with temporary IDs and dependencies, acceptance criteria, art requirements, questions and `human_gate: true`. Artifacts remain empty because this mode creates no artifacts. Questions and errors describe missing information. A successful draft is not an approved requirement or a completed JIRA task.

## Execution and failure behavior

### Live monitoring

Open **Tools > GameCLI > Window > Orchestrator**. The page refreshes once per second and lists active GameCLI analysis executions across projects for the current Windows user. It shows role, startup/running phase, project, execution ID, Codex session/turn IDs, PID and elapsed time. Live Agents counts established Codex sessions; Executions also includes jobs still starting. Both counts return to zero when all jobs exit. The four role Skill folders do not represent four running Agents.

To test, keep the page open and run the command above in a terminal. To observe two concurrent jobs, run it in two terminals. These are actual model calls and use your Codex account. Model progress and final analysis remain in the corresponding terminal. The monitor does not enumerate unrelated Codex desktop conversations, show JIRA backlog totals or retain task history.

Discovery records under `~/.gamecli/runs` contain local process metadata only, without requirement text, credentials or results. They are removed on normal exit. The viewer checks PID and process start time and ignores abandoned or malformed records. These records are operational telemetry, not authoritative workflow state; JIRA remains the source of truth for business tasks.

The CLI owns a dedicated `codex app-server` child process. `CodexRpcClient` exchanges newline-delimited JSON over stdin/stdout and drains stderr separately. The lifecycle is `initialize`, `initialized`, `thread/start`, `turn/start`, streamed events and `turn/completed`. Notifications are queued even if they arrive before a request continuation runs. Role skill contents and their source paths are explicitly supplied as developer instructions; global skill installation is not required.

The thread uses a read-only sandbox, no approval escalation and disabled web search. Its instructions prohibit mutations, JIRA writes and further agent dispatch. This draft mode is intended for requirement analysis; external tools from a user's Codex configuration are not a separate security boundary. Interactive requests fail explicitly instead of hanging or being auto-approved. No JIRA credentials are included in the input.

On timeout or Ctrl+C, the client attempts `turn/interrupt`, then closes its owned process; it kills that process tree if shutdown exceeds two seconds. It does not stop existing Codex desktop sessions. Codex may keep conversation history in its own storage. That history and the returned JSON are execution evidence, not a second workflow database.

Validation checks required fields, types, enum values, execution identity, task uniqueness, acceptance criteria, missing dependencies and dependency cycles. A failed or interrupted turn cannot become a successful draft. Raw server diagnostics are drained without forwarding them; protocol errors return a sanitized message. Account login, model access and provider connectivity are managed by Codex.

Exit codes: 0 validated success; 1 timeout/transport interruption; 2 invalid result or failed PM analysis; 3 blocked analysis, interactive action required, cancellation or rejected Codex execution; 4 invalid arguments; 5 missing project, skills or executable/configuration.

## Verification

Run deterministic protocol smoke tests without consuming model usage:

```powershell
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.CodexSmoke --configuration Release -- .
```

The fake process verifies the wire handshake and role/sandbox input, immediate event delivery, valid/blocked results, malformed JSON, missing/cyclic dependencies, failed turns, interactive requests, unexpected EOF and timeout. It is test infrastructure only; production always invokes the selected Codex executable.

On 2026-09-22 a real signed-in Codex run completed in approximately 124 seconds: the requirement was to display the configured version on the main menu, and the validated result contained a development task plus a QA task depending on it. No JIRA operation was performed. A separate 120-second run exercised cancellation during generation. The nine deterministic protocol smoke cases also passed. Validation reports under the repository's ignored `Artifacts` directory are local execution evidence.

Official protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server). The Unity Orchestrator page provides live process monitoring. A multi-role scheduler, JIRA transitions, resume UI and PM execution buttons in the Unity panel remain future work.
