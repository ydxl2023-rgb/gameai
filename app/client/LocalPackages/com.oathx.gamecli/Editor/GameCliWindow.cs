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
        private readonly StringBuilder output = new StringBuilder();
        private CancellationTokenSource operation;
        private string sourceProject;
        private string unityProject;
        private string status = "Ready";
        private MessageType statusType = MessageType.Info;
        private Vector2 scroll;

        [MenuItem("Tools/GameCLI/Window")]
        public static void Open()
        {
            GameCliWindow window = GetWindow<GameCliWindow>("GameCLI");
            window.minSize = new Vector2(420, 330);
        }

        private void OnEnable()
        {
            unityProject = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
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
                        RunOperation(true);
                    }
                }

                using (new EditorGUI.DisabledScope(busy || !installed))
                {
                    if (GUILayout.Button("Ping Unity"))
                    {
                        RunOperation(false);
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

            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!installed))
                {
                    if (GUILayout.Button("Show CLI"))
                    {
                        EditorUtility.RevealInFinder(executable);
                    }

                    if (GUILayout.Button("Copy Ping Command"))
                    {
                        // PowerShell invocation operator is required when the executable path is quoted.
                        EditorGUIUtility.systemCopyBuffer = "& '" + executable.Replace("'", "''") +
                            "' unity --ping --project '" + unityProject.Replace("'", "''") + "' --format json";
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

        private async void RunOperation(bool install)
        {
            if (operation != null)
            {
                return;
            }

            CancellationTokenSource current = new CancellationTokenSource();
            operation = current;
            output.Clear();
            status = install ? "Installing..." : "Pinging Unity...";
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
                int exitCode = install
                    ? await GameCliInstaller.InstallAsync(sourceProject, unityProject, log, current.Token)
                    : await GameCliInstaller.PingAsync(unityProject, log, current.Token);
                status = exitCode == 0 ? (install ? "Installation completed." : "Unity returned pong.") :
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
                status = exception.Message + (install ? " Check the .NET SDK and source project." : string.Empty);
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
