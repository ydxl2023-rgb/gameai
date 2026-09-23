using System;
using System.Threading;

using UnityEditor;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    // Intentionally not serialized: entered credentials must not enter Unity layouts or assets.
    internal sealed class JiraConnectionPanel
    {
        private readonly Action repaint;

        private readonly string configPath;

        private JiraConnectionSettings settings = new JiraConnectionSettings();

        private string secret = "";

        private string savedTarget;

        private string status = "Enter your JIRA connection, then save or test it.";

        private MessageType statusType = MessageType.Info;

        private string connectionStatus = "尚未测试连接";

        private bool connectionSucceeded;

        private CancellationTokenSource operation;

        private bool disposed;

        /// <summary>
        /// Restores public settings and the matching saved token without serializing panel state.
        /// </summary>
        public JiraConnectionPanel(Action repaint, string configPath = null)
        {
            this.repaint = repaint;
            this.configPath = configPath;
            try
            {
                settings = JiraSettingsStore.Load(configPath);
                if (!string.IsNullOrEmpty(settings.address))
                {
                    savedTarget = settings.CredentialTarget;
                    if (Application.platform == RuntimePlatform.WindowsEditor)
                    {
                        secret = WindowsCredentialStore.Read(savedTarget) ?? "";
                    }

                    status = "Saved configuration loaded. Connection has not been tested.";
                }
            }
            catch (Exception)
            {
                status = "Cannot load JIRA settings. Check ~/.gamecli/jira.json or enter a new configuration.";
                statusType = MessageType.Error;
            }
        }

        /// <summary>
        /// Draws and edits connection settings on the Unity Editor thread.
        /// </summary>
        public void Draw()
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("JIRA Connection", EditorStyles.boldLabel);
                bool supported = Application.platform == RuntimePlatform.WindowsEditor;
                using (new EditorGUI.DisabledScope(operation != null || !supported))
                {
                    EditorGUI.BeginChangeCheck();
                    settings.address = EditorGUILayout.TextField("JIRA Address", settings.address);
                    if (EditorGUI.EndChangeCheck())
                    {
                        connectionSucceeded = false;
                        connectionStatus = "配置已更改，请重新测试连接";
                        status = "Connection changed. Save or test the current values.";
                        statusType = MessageType.Info;
                    }

                    EditorGUI.BeginChangeCheck();
                    settings.ProjectKey = EditorGUILayout.TextField(
                        new GUIContent("Project Key", "Enter the JIRA project key, not its display name."),
                        settings.ProjectKey ?? "");
                    if (EditorGUI.EndChangeCheck())
                    {
                        // The connection indicator reflects account authentication, not project access.
                        status = "Project key changed. Save Configuration to keep this value.";
                        statusType = MessageType.Info;
                    }

                    GUILayout.Label("Enter the project key from JIRA project settings. Test Connection verifies your account, not project access.", EditorStyles.wordWrappedMiniLabel);

                    EditorGUI.BeginChangeCheck();
                    secret = EditorGUILayout.TextField("Access Token", secret);
                    if (EditorGUI.EndChangeCheck())
                    {
                        connectionSucceeded = false;
                        connectionStatus = "配置已更改，请重新测试连接";
                        status = "Token changed. Save Configuration to keep it after reopening or script reload.";
                        statusType = MessageType.Info;
                    }

                    GUILayout.Label("Saved tokens are restored automatically. Save Configuration to keep your changes after reopening or script reload.", EditorStyles.wordWrappedMiniLabel);
                    using (new EditorGUILayout.HorizontalScope())
                    {
                        if (GUILayout.Button("Save Configuration"))
                        {
                            Save();
                        }

                        if (GUILayout.Button("Test Connection"))
                        {
                            TestAsync();
                        }
                    }
                }

                if (operation != null && GUILayout.Button("Cancel Connection Test"))
                {
                    operation.Cancel();
                }

                if (!supported)
                {
                    EditorGUILayout.HelpBox("Credential storage currently requires Windows Editor.", MessageType.Info);
                }

                GUIStyle connectionStyle = new GUIStyle(EditorStyles.wordWrappedLabel)
                {
                    fontStyle = FontStyle.Bold,
                    richText = false
                };
                connectionStyle.normal.textColor = connectionSucceeded ? (EditorGUIUtility.isProSkin ? new Color(0.3f, 0.85f, 0.4f) : new Color(0.1f, 0.5f, 0.2f)) : (EditorGUIUtility.isProSkin ? new Color(0.65f, 0.65f, 0.65f) : new Color(0.4f, 0.4f, 0.4f));
                GUILayout.Label(connectionStatus, connectionStyle);
                EditorGUILayout.HelpBox(status, statusType);
                GUILayout.Label("Connection settings: ~/.gamecli/jira.json. Credentials: Windows Credential Manager. JIRA remains the sole workflow data source.", EditorStyles.wordWrappedMiniLabel);
            }
        }

        /// <summary>
        /// Clears the in-memory token and cancels an outstanding test without blocking the Editor.
        /// </summary>
        public void Dispose()
        {
            disposed = true;
            secret = "";
            operation?.Cancel();
        }

        private string ResolveSecret(JiraConnectionSettings current)
        {
            if (!string.IsNullOrEmpty(secret))
            {
                return secret;
            }

            // Never reuse a stored access token for a different server.
            string stored = current.CredentialTarget == savedTarget ? WindowsCredentialStore.Read(savedTarget) : null;
            if (string.IsNullOrEmpty(stored))
            {
                throw new ArgumentException("Enter a credential for this connection.");
            }

            return stored;
        }

        private bool Save()
        {
            try
            {
                JiraConnectionSettings current = settings.Normalized();
                string token = ResolveSecret(current);
                JiraSettingsStore.Save(current, token, configPath);
                settings = current;
                savedTarget = current.CredentialTarget;
                secret = token;
                status = "Configuration saved. Use Test Connection to verify access.";
                statusType = MessageType.Info;
                return true;
            }
            catch (Exception exception)
            {
                status = exception is ArgumentException ? exception.Message : "Unable to save JIRA configuration or Windows credential.";
                statusType = MessageType.Error;
                return false;
            }
        }

        private async void TestAsync()
        {
            CancellationTokenSource current = new CancellationTokenSource();
            operation = current;
            connectionSucceeded = false;
            connectionStatus = "正在测试连接…";
            status = "Connection testing does not save configuration changes.";
            statusType = MessageType.Info;
            try
            {
                JiraConnectionSettings snapshot = settings.Normalized();
                string displayName = await JiraConnectionClient.TestAsync(snapshot, ResolveSecret(snapshot), current.Token);
                connectionSucceeded = true;
                connectionStatus = "连接成功 · Connected as " + displayName;
            }
            catch (OperationCanceledException)
            {
                connectionStatus = current.IsCancellationRequested ? "连接测试已取消" : "连接失败 · JIRA connection test timed out.";
            }
            catch (Exception exception)
            {
                connectionStatus = "连接失败 · " + (exception is ArgumentException || exception is InvalidOperationException ? exception.Message : "Unable to test JIRA access. Check the connection settings and credential store.");
            }
            finally
            {
                operation = null;
                current.Dispose();
                if (!disposed)
                {
                    repaint();
                }
            }
        }
    }
}
