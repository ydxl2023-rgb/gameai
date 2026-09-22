# Game CLI package structure

This scaffold combines the reference `com.oathx.unitycli` package layout with the AI workflow outline. It contains directories only; no CLI, Unity bridge, or package registration is implemented yet.

```text
com.oathx.gamecli/
|-- Docs/                        Package documentation
|-- Editor/                      Unity Editor integration
|   |-- Bridge/                  External CLI communication
|   |-- Commands/                Unity command handlers
|   |-- Plugins/                 Editor extensions
|   `-- Services/                Import, validation and build services
|-- Runtime/                     Shared runtime contracts, when needed
|-- game-cli/                    Agent-facing usage resources
|   |-- examples/
|   |-- references/
|   `-- scripts/
`-- GameCLI~/                    Standalone CLI workspace, excluded from Unity asset import
    |-- gameai/                  Python CLI package
    |   |-- commands/            Thin command entry points
    |   |-- core/                State machine, JIRA execution records and orchestration
    |   |-- agents/              PM, Art, Dev and QA implementations
    |   `-- skills/              Executable Python skills, distinct from usage resources
    |       |-- common/
    |       |-- jira/
    |       |-- art/
    |       |-- dev/
    |       |-- unity/
    |       `-- qa/
    |-- unity-runner/            Unity runner configuration
    |-- tests/
    |   |-- unit/
    |   |-- contract/
    |   `-- integration/
    `-- workspace/              Generated artifacts only, never authoritative workflow state
        |-- assets/
        |-- repo/
        `-- builds/
```

JIRA is the sole source of truth for task status, approvals, retries and execution records. No SQLite database or local JIRA state file is planned.

`.gitkeep` files preserve empty directories in Git. Generated workspace contents are ignored. Entry-point files, `pyproject.toml`, Unity assembly definitions and `package.json` will be added when their implementations are introduced.
