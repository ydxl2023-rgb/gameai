# Game CLI package structure

All executable development uses C#. The existing standalone console project targets .NET 8. Standard Markdown skills remain portable instructions for AI tools; they are not executable Agent implementations.

```text
com.oathx.gamecli/
|-- Docs/
|-- Editor/                      Unity Editor C# integration
|   |-- Bridge/
|   |-- Commands/
|   |-- Plugins/
|   `-- Services/
|-- Runtime/                     Unity runtime C# contracts, as needed
|-- game-cli/                    Portable standard skills
|   |-- gameai-cli-development/SKILL.md
|   |-- gameai-pm/SKILL.md
|   |-- gameai-art/SKILL.md
|   |-- gameai-dev/SKILL.md
|   |-- gameai-qa/SKILL.md
|   |-- gameai-orchestrator/SKILL.md
|   |-- gameai-common/SKILL.md
|   |-- gameai-jira/SKILL.md
|   |-- gameai-unity/SKILL.md
|   |-- examples/
|   |-- references/
|   `-- scripts/
`-- GameCLI~/                    Excluded from Unity asset import
    `-- GameCLI/
        |-- GameCLI.sln          Existing VS solution
        `-- GameCLI/
            |-- GameCLI.csproj   Existing .NET 8 console project
            `-- Program.cs      Existing template entry point
```

Planned C# source folders inside the console project: Commands, Core, Contracts, Agents and Services. Future tests belong beside the project. These folders and their business implementations are not created yet. The former Python scaffold has been removed by the project owner and is not restored.

JIRA is the sole source of truth for task status, approvals, retries and execution records. No SQLite database or local JIRA state file is planned. Reports and generated artifacts are not an alternative workflow state store.

Copy the required gameai-* folders into an AI tool's skill root, preserving names and sibling layout. Include referenced shared skills; the orchestrator references all four role skills. Copying all nine folders preserves every relative reference. The gameai-cli-development skill governs this repository; root AGENTS.md routes future development to it. It is not another business Agent. No automatic installation is performed.

The standalone .csproj and .sln are source files and must be versioned. Unity-generated IDE projects remain ignored, as do bin, obj and .vs. The .NET 8 console project runs outside Unity; its target framework is not the Unity runtime framework.
