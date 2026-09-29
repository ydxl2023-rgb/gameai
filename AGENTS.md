# ugame-ai-cli

For development in this repository, read and apply
`app/client/LocalPackages/com.oathx.gamecli/game-cli/gameai-cli-development/SKILL.md`.

Use the existing C#/.NET 8 console project under `GameCLI~/GameCLI`.
Keep distributable standard skills under `com.oathx.gamecli/game-cli`.
The coordination service is Node.js under `GameCLI~/GameCLIServer`; this is the
explicit server-side exception to the C# CLI implementation rule.
Follow `docs/gamecli-server-architecture.md` for the event protocol and rollout boundaries.
For new platform development, read `docs/GameAI协作平台技术开发纲要.html`: React/TypeScript + Ant Design, a single-project Track UI, and PostgreSQL as the target authoritative business store. PostgreSQL is the sole business store. The former external issue-tracker integration has been removed; do not reintroduce its commands or configuration. Local HTTP human review and Design document submission are implemented. Fixed-role execution leases and per-requirement conversation recovery are implemented; manual PM publication for approved HTML is implemented; manual local specialist dispatch is implemented; opt-in same-plan completion-driven dispatch is implemented; remote worker dispatch remains pending. All role invocations must use the fixed cloud Agent and carry a requirement key; see gameai-common/SKILL.md. Design credentials must never authorize human approval. Use `pwsh.exe` for Windows commands.
Preserve user changes and exclude Unity/IDE caches and build output from commits.

When the user provides a game requirement document in the conversation and asks
to start the development workflow, read and apply
`docs/gamecli-server-architecture.md` and the Design/PM role skills.
All business orchestration belongs exclusively to GameCLIServer. GameCLI is an
execution client, not a local scheduler. Preserve reusable Agent process and
transport components; never recreate a local Orchestrator plugin.
The conversation is the requirement input, review and approval surface. Invoke
GameCLI on the user's behalf; do not ask the user to enter documents or operate
workflow buttons in the Unity panel. Merely attaching a document for discussion
does not authorize starting the workflow or creating platform tasks.

For user-facing document deliverables, apply `app/client/LocalPackages/com.oathx.gamecli/game-cli/gameai-document-format/SKILL.md`. Deliver outline-style standalone HTML with a cover, linked contents and print styling; the conversation host renders structured agent results. Keep SKILL.md, CLI schemas and structured task formats unchanged.

Design document artifacts must be saved under `app/desgin/` relative to this repository root; preserve this spelling and create the directory automatically when absent. The conversation host writes artifacts there when the Design process cannot write files. Do not resolve this path relative to `app/client/`.
