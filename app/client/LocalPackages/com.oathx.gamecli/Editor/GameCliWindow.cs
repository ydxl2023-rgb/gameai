using System;
using System.IO;
using System.Text;
using System.Threading;
using UnityEditor;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    public sealed class GameCliWindow : EditorWindow
    {
        private const int MaximumLogLength = 60000;
        private static readonly string[] CommandPages =
        {
            "Orchestrator", "PM", "Art", "Development", "Unity", "QA"
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
        private Vector2 commandScroll;

        [MenuItem("Tools/GameCLI/Window")]
        public static void Open()
        {
            GameCliWindow window = GetWindow<GameCliWindow>("GameCLI");
            window.minSize = new Vector2(560, 420);
        }

        private void OnEnable()
        {
            minSize = new Vector2(560, 420);
            unityProject = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            GameCliCommandSettings.Initialize(unityProject);
            PackageInfo package = PackageInfo.FindForAssembly(typeof(GameCliWindow).Assembly);
            sourceProject = package == null ? string.Empty :
                Path.Combine(package.resolvedPath, "GameCLI~", "GameCLI", "GameCLI", "GameCLI.csproj");
        }

        private void OnDisable()
        {
            operation?.Cancel();
        }

        private void OnGUI()
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
                using (new EditorGUI.DisabledScope(busy || !File.Exists(sourceProject) ||
                    Application.platform != RuntimePlatform.WindowsEditor))
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
            selectedPage = GUILayout.Toolbar(selectedPage, CommandPages, EditorStyles.toolbarButton);
            DrawCommandPage();
            EditorGUILayout.Space(8);
            EditorGUILayout.LabelField("Output", EditorStyles.miniBoldLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.TextArea(output.ToString(), GUILayout.ExpandHeight(true));
            EditorGUILayout.EndScrollView();
        }

        private void DrawRelativePath(string absolutePath)
        {
            string displayPath = string.IsNullOrEmpty(absolutePath)
                ? "(not found)"
                : Path.GetRelativePath(unityProject, absolutePath).Replace('\\', '/');
            // A wrapped label is display-only; execution continues to use the original absolute path.
            GUILayout.Label(displayPath, EditorStyles.wordWrappedLabel);
        }

        private void DrawCommandPage()
        {
            selectedPage = Mathf.Clamp(selectedPage, 0, CommandPages.Length - 1);
            EditorGUILayout.Space(6);
            EditorGUILayout.LabelField(CommandPages[selectedPage], EditorStyles.boldLabel);
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
                    description = "Asset generation, validation and delivery.";
                    break;
                case 3:
                    description = "Code implementation, fixes and development validation.";
                    break;
                case 4:
                    description = "Unity Editor connectivity, compilation, tests and builds.";
                    break;
                default:
                    description = "Acceptance checks, evidence review and failure classification.";
                    break;
            }

            GUILayout.Label(description, EditorStyles.wordWrappedLabel);
            if (selectedPage == 4)
            {
                DrawUnityCommandList();
            }
            else
            {
                EditorGUILayout.HelpBox("Commands for this category are not implemented yet.", MessageType.Info);
            }
        }

        private void DrawUnityCommandList()
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    EditorGUILayout.LabelField("On", EditorStyles.miniBoldLabel, GUILayout.Width(28));
                    EditorGUILayout.LabelField("Command", EditorStyles.miniBoldLabel, GUILayout.Width(80));
                    EditorGUILayout.LabelField("Method", EditorStyles.miniBoldLabel, GUILayout.Width(50));
                    EditorGUILayout.LabelField("Route", EditorStyles.miniBoldLabel, GUILayout.Width(60));
                    EditorGUILayout.LabelField("Status", EditorStyles.miniBoldLabel, GUILayout.Width(70));
                    EditorGUILayout.LabelField("Description", EditorStyles.miniBoldLabel);
                }

                commandScroll = EditorGUILayout.BeginScrollView(commandScroll, GUILayout.Height(70));
                using (new EditorGUILayout.HorizontalScope())
                {
                    bool enabled = GameCliCommandSettings.IsEnabled("/ping");
                    bool nextEnabled = EditorGUILayout.Toggle(
                        new GUIContent(string.Empty, "Allow or reject incoming PING commands for this project."),
                        enabled, GUILayout.Width(28));
                    if (nextEnabled != enabled)
                    {
                        GameCliCommandSettings.SetEnabled("/ping", nextEnabled);
                        enabled = nextEnabled;
                    }

                    // Keep the toggle interactive so a disabled command can always be re-enabled.
                    using (new EditorGUI.DisabledScope(!enabled))
                    {
                        EditorGUILayout.LabelField(new GUIContent("ping", "GameCLI.exe unity --ping"),
                            EditorStyles.boldLabel, GUILayout.Width(80));
                        EditorGUILayout.LabelField("GET", GUILayout.Width(50));
                        EditorGUILayout.LabelField("ping", GUILayout.Width(60));
                        EditorGUILayout.LabelField(enabled ? "Enabled" : "Disabled", GUILayout.Width(70));
                        GUILayout.Label("Check the Unity Editor connection.", EditorStyles.wordWrappedLabel);
                    }
                }

                EditorGUILayout.EndScrollView();
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
                status = exitCode == 0 ? "Installation completed." :
                    "Operation failed (exit " + exitCode + "). See output.";
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
