# ugame-ai-cli

For development in this repository, read and apply
`game-cli/skills/gameai-common/gameai-cli-development/SKILL.md`.

Use the existing C#/.NET 8 console project under `game-cli/src/GameAI.Cli`.
Keep distributable standard skills under `game-cli/skills/`.
The coordination service is Node.js under `game-cli/src/GameAI.Server`; this is the
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

For new or revised requirements, first apply the plugin entry skill
`game-cli/plugins/gameai-track/skills/gameai-requirement-draft/SKILL.md`.
Each requirement discussion turn returns a short complete text draft, without HTML
or wireframes. Do not invoke cloud Design or upload until the user explicitly
approves that draft version. Draft approval does not replace formal Track approval.
Every issue requiring a decision must be resolved in the draft conversation before
handoff; approval alone does not bypass unresolved issues. Do not delegate pending
decisions to Design. Explicit bounded creative freedom counts as a resolved choice.
The required sequence is conversation and necessary research, resolve every draft
decision, human approval of the draft, precise prompt preparation, Design writing,
Design self-check and revision, human approval of the final HTML in Track, then PM
decomposition. Research belongs to the plugin conversation stage; Design must not
repeat it or reopen settled decisions. New decision gaps return to draft review.
Draft approval and Design self-check never authorize PM publication; preserve
each role's actual automatic-execution grants after formal Track approval.

For user-facing document deliverables, apply `game-cli/skills/gameai-common/gameai-document-format/SKILL.md`. Deliver outline-style standalone HTML with a cover, linked contents and print styling; the conversation host renders structured agent results. Keep SKILL.md, CLI schemas and structured task formats unchanged.

Design document artifacts must be saved under `app/desgin/` relative to this repository root; preserve this spelling and create the directory automatically when absent. The conversation host writes artifacts there when the Design process cannot write files. Do not resolve this path relative to `app/client/`.

UI production uses a separate Prefab role and gameai-prefab skill: whitebox prefab -> Art resources -> final prefab assembly. Business Development may start from stable whitebox bindings; final QA depends on assembled UI and business delivery. Keep one responsibility chain per Agent and preserve per-role automatic-execution consent.

Store production intermediate files under `game-cli/temp/`, grouped by execution ID. Keep final requirements and deliverables in their established locations; do not move connection credentials into temp.

PM business plans target client-side delivery only. Treat backend implementation, databases, administration and deployment as external dependencies, never scheduled tasks. Client integration and explicitly approved local mocks remain in scope; this does not prohibit maintaining the GameAI orchestration service.
