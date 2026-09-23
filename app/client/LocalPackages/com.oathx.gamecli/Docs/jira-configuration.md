# JIRA connection configuration

Open **Tools > GameCLI > Window > PM**. JIRA Connection is the first PM feature.

1. Enter the JIRA base address, including any server context path (for example `https://jira.example.com/jira`). Do not include an issue URL or `/rest/api` suffix.
2. Enter **Access Token** in the plain-text field; entered characters are visible. As in the reference UnityCLI project, requests use `Authorization: Bearer <token>`. Authentication uses **JIRA Address** and **Access Token**; there is no account or authentication selector.
3. Enter **Project Key** using the key from JIRA project settings, not the project display name. It is saved with public settings, trims surrounding whitespace, and preserves letter case. It may remain empty for existing configurations and account-only connection testing. Changing it does not replace the token or reset the account connection indicator; project access is not yet checked.
4. Click **Test Connection** to authenticate the current values using `GET /rest/api/2/myself`. Success displays a green **连接成功 · Connected as ...** line with the authenticated user's name. Failure displays a gray **连接失败** line with its reason. Changing the address or token resets the indicator to gray pending retest. This checks identity only, not project access or issue creation permissions. Testing does not save changes.
5. Click **Save Configuration** to persist the connection. The token stays visible after saving and is automatically restored from Windows Credential Manager when the window reopens or Unity reloads scripts. Editing the address does not clear the visible token. Unsaved edits remain in memory only, so save them before closing or script reload. Existing Bearer credentials remain usable; previously saved Basic credentials are not reused. Older configuration files retain their address and load an empty Project Key; saving writes both address and projectKey.

Connection metadata is saved per Windows user in `~/.gamecli/jira.json`, outside the Unity project. Credentials are saved separately in Windows Credential Manager under a `GameCLI/Jira/` target derived from the connection identity. Credentials are not serialized into Unity layouts, project assets, JSON or logs. This configuration is shared across local projects for that Windows user. Earlier connections' credentials remain in Credential Manager and can be removed there.

Tests run asynchronously with a 15-second timeout and cancellation. Redirects are rejected without forwarding credentials. Authentication failures and invalid server responses are reported in the panel. Credential storage currently supports Windows Editor.

JIRA remains the sole authority for workflow state. The local file contains connection metadata only. The standalone CLI supports [read-only PM analysis through Codex](codex-pm.md) and the task creation operation below. The [Orchestrator workflow](orchestrator-workflow.md) now starts a Design agent, waits for approval of its requirement version, and starts a separate PM agent to publish tasks.

## Create one task through the CLI

The PM page contains connection configuration and testing only; the manual task creation form has been removed. The CLI creation capability remains available for future Agent integration. After updating the package, use **Reinstall GameCLI** to update the executable in this project's Library directory.

The CLI command reads the saved address, Project Key and Windows credential without putting the token on the command line:

```powershell
GameCLI.exe jira --create --summary "实现游戏主界面" --description "显示标题和开始按钮" --format json
```

Both `jira create` and `jira --create` are supported. The client queries `/rest/api/2/project/{key}`, selects a non-subtask type named `Task` or `任务`, then posts `project`, `issuetype`, `summary`, and optional plain-text `description` to `/rest/api/2/issue`. For a renamed task type, the CLI accepts `--issue-type <name-or-id>`; it must be a non-subtask type in that project. Additional required fields are reported by JIRA and are not silently fabricated. This initial version targets the existing Bearer/v2 JIRA connection, not a new Cloud OAuth or v3 integration.

The JIRA CLI plugin enforces its enable/disable gate. Requests have a 30-second HTTP timeout. Redirects are disabled. No POST is automatically retried. If the response is lost, cancelled, malformed, or fails on the server after submission, the result reports `outcome_unknown: true` with exit code 3. Check JIRA before retrying; this version does not provide server-side idempotency or prevent a second explicit invocation from creating another issue.

Tests use fake HTTP and do not create real issues:

```powershell
dotnet run --project app/client/LocalPackages/com.oathx.gamecli/GameCLI~/GameCLI/Tests/GameCLI.JiraSmoke --configuration Release
```

Creation API reference: [JIRA REST create issue](https://developer.atlassian.com/server/jira/platform/jira-rest-api-example-create-issue-7897248/).

Official authentication references: [Data Center personal access tokens](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html), [current-user REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-myself/).
