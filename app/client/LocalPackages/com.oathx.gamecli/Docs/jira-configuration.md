# JIRA connection configuration

Open **Tools > GameCLI > Window > PM**. JIRA Connection is the first PM feature.

1. Enter the JIRA base address, including any server context path (for example `https://jira.example.com/jira`). Do not include an issue URL or `/rest/api` suffix.
2. Enter **Access Token** in the plain-text field; entered characters are visible. As in the reference UnityCLI project, requests use `Authorization: Bearer <token>`. The only connection fields are **JIRA Address** and **Access Token**; there is no account or authentication selector.
3. Click **Test Connection** to authenticate the current values using `GET /rest/api/2/myself`. Success displays a green **连接成功 · Connected as ...** line with the authenticated user's name. Failure displays a gray **连接失败** line with its reason. Changing the address or token resets the indicator to gray pending retest. This checks identity only, not project access or issue creation permissions. Testing does not save changes.
4. Click **Save Configuration** to persist the connection. The token stays visible after saving and is automatically restored from Windows Credential Manager when the window reopens or Unity reloads scripts. Editing the address does not clear the visible token. Unsaved edits remain in memory only, so save them before closing or script reload. Existing Bearer credentials remain usable; previously saved Basic credentials are not reused. Older configuration files retain their address when loaded and are rewritten with address only when saved.

Connection metadata is saved per Windows user in `~/.gamecli/jira.json`, outside the Unity project. Credentials are saved separately in Windows Credential Manager under a `GameCLI/Jira/` target derived from the connection identity. Credentials are not serialized into Unity layouts, project assets, JSON or logs. This configuration is shared across local projects for that Windows user. Earlier connections' credentials remain in Credential Manager and can be removed there.

Tests run asynchronously with a 15-second timeout and cancellation. Redirects are rejected without forwarding credentials. Authentication failures and invalid server responses are reported in the panel. Credential storage currently supports Windows Editor.

JIRA remains the sole authority for workflow state. The local file contains connection metadata only. The standalone CLI supports [read-only PM analysis through Codex](codex-pm.md). JIRA task creation and the standalone `GameCLI jira` command group remain planned; the Editor currently provides connection configuration and testing.

Official authentication references: [Data Center personal access tokens](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html), [current-user REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-myself/).
