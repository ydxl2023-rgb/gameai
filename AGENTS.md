# ugame-ai-cli

For development in this repository, read and apply
`app/client/LocalPackages/com.oathx.gamecli/game-cli/gameai-cli-development/SKILL.md`.

Use the existing C#/.NET 8 console project under `GameCLI~/GameCLI`.
Keep distributable standard skills under `com.oathx.gamecli/game-cli`.
The coordination service is Node.js under `GameCLI~/GameCLIServer`; this is the
explicit server-side exception to the C# CLI implementation rule.
Follow `docs/gamecli-server-architecture.md` for the event protocol and rollout boundaries.
JIRA is the sole source of truth for workflow state. Use `pwsh.exe` for Windows commands.
Preserve user changes and exclude Unity/IDE caches and build output from commits.

When the user provides a game requirement document in the conversation and asks
to start the development workflow, read and apply
`app/client/LocalPackages/com.oathx.gamecli/game-cli/gameai-orchestrator/SKILL.md`.
The conversation is the requirement input, review and approval surface. Invoke
GameCLI on the user's behalf; do not ask the user to enter documents or operate
workflow buttons in the Unity panel. Merely attaching a document for discussion
does not authorize starting the workflow or creating JIRA issues.

For user-facing document deliverables, apply `app/client/LocalPackages/com.oathx.gamecli/game-cli/gameai-document-format/SKILL.md`. Deliver outline-style standalone HTML with a cover, linked contents and print styling; the conversation host renders structured agent results. Keep SKILL.md, CLI schemas and JIRA body formats unchanged.

Design document artifacts must be saved under `app/desgin/` relative to this repository root; preserve this spelling and create the directory automatically when absent. The conversation host writes artifacts there when the Design process cannot write files. Do not resolve this path relative to `app/client/`.
