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

        private float headerContentHeight = 320;

        [SerializeField]
        private float listRatio = 0.8f;

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
            if (EditorApplication.timeSinceStartup >= nextMonitorRefresh)
            {
                nextMonitorRefresh = EditorApplication.timeSinceStartup + 1;
                agentMonitor.Refresh(unityProject);
                Repaint();
            }
        }

        private void OnGUI()
        {
            // The header owns its natural height; only the lower list/output boundary is draggable.
            EditorGUILayout.BeginVertical(GUILayout.ExpandHeight(false));
            DrawHeader();
            EditorGUILayout.EndVertical();
            if (Event.current.type == EventType.Repaint)
            {
                float measuredHeight = GUILayoutUtility.GetLastRect().yMax;
                if (Mathf.Abs(headerContentHeight - measuredHeight) > 1)
                {
                    headerContentHeight = measuredHeight;
                    Repaint();
                }
            }

            float headerHeight = headerContentHeight;
            const float dividerHeight = 6;
            float availableHeight = Mathf.Max(0, position.height - headerHeight - dividerHeight);
            float minimumList = Mathf.Min(100, availableHeight * 0.5f);
            float minimumOutput = Mathf.Min(60, availableHeight * 0.3f);
            float listHeight = Mathf.Clamp(availableHeight * listRatio, minimumList, availableHeight - minimumOutput);
            Rect divider = new Rect(0, headerHeight + listHeight, position.width, dividerHeight);
            DrawDivider(divider, headerHeight, availableHeight, minimumList, minimumOutput);

            // Explicit pane bounds prevent nested scroll views from consuming the output area.
            GUILayout.BeginArea(new Rect(0, headerHeight, position.width, listHeight));
            agentMonitor.Draw(selectedPage == 0 ? null : commandPages[selectedPage]);
            GUILayout.EndArea();

            GUILayout.BeginArea(new Rect(0, divider.yMax, position.width, availableHeight - listHeight));
            EditorGUILayout.LabelField("Output", EditorStyles.miniBoldLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.ExpandHeight(true));
            EditorGUILayout.TextArea(output.ToString(), GUILayout.ExpandHeight(true));
            EditorGUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        private void DrawDivider(Rect divider, float top, float availableHeight, float minimumList, float minimumOutput)
        {
            int control = GUIUtility.GetControlID("GameCliPaneDivider".GetHashCode(), FocusType.Passive);
            EditorGUIUtility.AddCursorRect(divider, MouseCursor.ResizeVertical);
            EditorGUI.DrawRect(divider, EditorGUIUtility.isProSkin ? new Color(0.13f, 0.13f, 0.13f) : new Color(0.6f, 0.6f, 0.6f));
            EditorGUI.DrawRect(new Rect(divider.center.x - 18, divider.y + 2, 36, 2), Color.gray);
            Event current = Event.current;
            switch (current.GetTypeForControl(control))
            {
                case EventType.MouseDown:
                    if (current.button == 0 && divider.Contains(current.mousePosition))
                    {
                        GUIUtility.hotControl = control;
                        current.Use();
                    }
                    break;
                case EventType.MouseDrag:
                    if (GUIUtility.hotControl == control && availableHeight > 0)
                    {
                        listRatio = Mathf.Clamp(current.mousePosition.y - top, minimumList, availableHeight - minimumOutput) / availableHeight;
                        current.Use();
                        Repaint();
                    }
                    break;
                case EventType.MouseUp:
                    if (GUIUtility.hotControl == control)
                    {
                        GUIUtility.hotControl = 0;
                        current.Use();
                    }
                    break;
            }
        }

        private void DrawHeader()
        {
            string executable = GameCliInstaller.GetExecutablePath(unityProject);
            bool installed = File.Exists(executable);
            bool busy = operation != null;
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
            if (selectedPage == 2)
            {
                EditorGUILayout.Space(8);
                jiraPanel.Draw();
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
