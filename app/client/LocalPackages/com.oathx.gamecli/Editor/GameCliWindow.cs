using System;
using System.IO;
using System.Text;
using System.Threading;

using UnityEditor;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Hosts CLI installation, command configuration, and live execution monitoring.
    /// </summary>
    public sealed class GameCliWindow : EditorWindow
    {
        private const int MaximumLogLength = 60000;

        private static readonly string[] commandPages =
        {
            "Orchestrator",
            "Design",
            "PM",
            "Art",
            "Development",
            "QA"
        };

        [SerializeField]
        private int selectedPage;

        private readonly StringBuilder output = new StringBuilder();

        private CancellationTokenSource operation;

        private string sourceProject;

        private string unityProject;

        private string status = "Ready";

        private MessageType statusType = MessageType.Info;

        private Vector2 scroll;

        private Vector2 windowScroll;

        private JiraConnectionPanel jiraPanel;

        private AgentMonitorPanel agentMonitor;

        private double nextMonitorRefresh;

        /// <summary>Opens or focuses the GameCLI Editor window.</summary>
        [MenuItem("Tools/GameCLI/Window")]
        public static void Open()
        {
            GameCliWindow window = GetWindow<GameCliWindow>("GameCLI");
            window.minSize = new Vector2(560, 420);
        }

        private void OnEnable()
        {
            minSize = new Vector2(560, 420);
            jiraPanel = new JiraConnectionPanel(Repaint);
            agentMonitor = new AgentMonitorPanel();
            nextMonitorRefresh = 0;
            EditorApplication.update += RefreshMonitor;
            unityProject = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            GameCliCommandSettings.Initialize(unityProject);
            PackageInfo package = PackageInfo.FindForAssembly(typeof(GameCliWindow).Assembly);
            sourceProject = package == null ? string.Empty : Path.Combine(package.resolvedPath, "GameCLI~", "GameCLI", "GameCLI", "GameCLI.csproj");
        }

        private void OnDisable()
        {
            operation?.Cancel();
            jiraPanel?.Dispose();
            EditorApplication.update -= RefreshMonitor;
        }

        private void RefreshMonitor()
        {
            if (selectedPage == 0 && EditorApplication.timeSinceStartup >= nextMonitorRefresh)
            {
                nextMonitorRefresh = EditorApplication.timeSinceStartup + 1;
                agentMonitor.Refresh();
                Repaint();
            }
        }

        private void OnGUI()
        {
            string executable = GameCliInstaller.GetExecutablePath(unityProject);
            bool installed = File.Exists(executable);
            bool busy = operation != null;
            windowScroll = EditorGUILayout.BeginScrollView(windowScroll);
            EditorGUILayout.LabelField("GameCLI Installer", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("CLI", installed ? "Installed" : "Not Installed");
            EditorGUILayout.HelpBox(status, statusType);
            EditorGUILayout.LabelField("Source Project", EditorStyles.miniBoldLabel);
            DrawRelativePath(sourceProject);
            EditorGUILayout.LabelField("Installed Executable", EditorStyles.miniBoldLabel);
            DrawRelativePath(executable);
            EditorGUILayout.HelpBox("Requires the .NET 8 SDK (or a compatible newer SDK) on PATH. Installs into this project's Library folder.", MessageType.Info);
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(busy || !File.Exists(sourceProject) || Application.platform != RuntimePlatform.WindowsEditor))
                {
                    if (GUILayout.Button(installed ? "Reinstall GameCLI" : "Install GameCLI"))
                    {
                        RunInstallAsync();
                    }
                }

                using (new EditorGUI.DisabledScope(!busy))
                {
                    if (GUILayout.Button("Cancel"))
                    {
                        operation.Cancel();
                    }
                }
            }

            if (!File.Exists(sourceProject))
            {
                EditorGUILayout.HelpBox("The package does not contain GameCLI~/GameCLI/GameCLI/GameCLI.csproj.", MessageType.Warning);
            }

            if (Application.platform != RuntimePlatform.WindowsEditor)
            {
                EditorGUILayout.HelpBox("This installer currently supports the Windows Editor.", MessageType.Warning);
            }

            EditorGUILayout.Space(8);
            selectedPage = GUILayout.Toolbar(selectedPage, commandPages, EditorStyles.toolbarButton);
            DrawCommandPage();
            EditorGUILayout.Space(8);
            EditorGUILayout.LabelField("Output", EditorStyles.miniBoldLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.Height(100));
            EditorGUILayout.TextArea(output.ToString(), GUILayout.ExpandHeight(true));
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndScrollView();
        }

        private void DrawRelativePath(string absolutePath)
        {
            string displayPath = string.IsNullOrEmpty(absolutePath) ? "(not found)" : Path.GetRelativePath(unityProject, absolutePath).Replace('\\', '/');
            // A wrapped label is display-only; execution continues to use the original absolute path.
            GUILayout.Label(displayPath, EditorStyles.wordWrappedLabel);
        }

        private void DrawCommandPage()
        {
            selectedPage = Mathf.Clamp(selectedPage, 0, commandPages.Length - 1);
            EditorGUILayout.Space(6);
            EditorGUILayout.LabelField(commandPages[selectedPage], EditorStyles.boldLabel);
            string description;
            switch (selectedPage)
            {
                case 0:
                    description = "Workflow scheduling, dependencies, retries and approval gates.";
                    break;
                case 1:
                    description = "Requirement analysis, task breakdown and acceptance criteria.";
                    break;
                case 2:
                    description = "JIRA configuration, task organization, dependencies and progress tracking.";
                    break;
                case 3:
                    description = "Asset generation, validation and delivery.";
                    break;
                case 4:
                    description = "Code implementation, fixes and development validation.";
                    break;
                default:
                    description = "Acceptance checks, evidence review and failure classification.";
                    break;
            }

            GUILayout.Label(description, EditorStyles.wordWrappedLabel);
            if (selectedPage == 0)
            {
                EditorGUILayout.HelpBox("Provide your requirement document in the Codex conversation to start the workflow. This panel monitors running agents.", MessageType.Info);
                agentMonitor.Draw();
            }
            else if (selectedPage == 2)
            {
                jiraPanel.Draw();
            }
            else
            {
                EditorGUILayout.HelpBox("Commands for this category are not implemented yet.", MessageType.Info);
            }
        }

        private async void RunInstallAsync()
        {
            if (operation != null)
            {
                return;
            }

            CancellationTokenSource current = new CancellationTokenSource();
            operation = current;
            output.Clear();
            status = "Installing...";
            statusType = MessageType.Info;
            // Progress captures Unity's synchronization context; GUI state changes stay on the editor thread.
            Progress<string> log = new Progress<string>(line =>
            {
                if (this == null || operation != current)
                {
                    return;
                }

                output.AppendLine(line);
                if (output.Length > MaximumLogLength)
                {
                    output.Remove(0, output.Length - MaximumLogLength);
                }

                Repaint();
            });
            try
            {
                int exitCode = await GameCliInstaller.InstallAsync(sourceProject, unityProject, log, current.Token);
                status = exitCode == 0 ? "Installation completed." : "Operation failed (exit " + exitCode + "). See output.";
                statusType = exitCode == 0 ? MessageType.Info : MessageType.Error;
            }
            catch (OperationCanceledException)
            {
                status = "Operation cancelled.";
                statusType = MessageType.Warning;
            }
            catch (Exception exception)
            {
                status = exception.Message + " Check the .NET SDK and source project.";
                statusType = MessageType.Error;
            }
            finally
            {
                operation = null;
                current.Dispose();
                if (this != null)
                {
                    Repaint();
                }
            }
        }
    }
}
