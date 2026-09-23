using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

using UnityEditor;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    internal sealed class AgentMonitorPanel
    {
        private readonly List<Run> runs = new List<Run>();

        private string error;

        /// <summary>
        /// Refreshes transient execution records and filters out exited or reused process IDs.
        /// </summary>
        public void Refresh()
        {
            runs.Clear();
            error = null;
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "runs");
            if (!Directory.Exists(directory))
            {
                return;
            }

            try
            {
                foreach (string path in Directory.GetFiles(directory, "*.json"))
                {
                    ReadRun(path);
                }

                runs.Sort((left, right) => left.started.CompareTo(right.started));
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                error = "Cannot read local execution records.";
            }
        }

        private void ReadRun(string path)
        {
            try
            {
                Run run = JsonUtility.FromJson<Run>(File.ReadAllText(path));
                if (run == null || run.version != 1 || run.pid <= 0 || run.started <= 0 || string.IsNullOrEmpty(run.executionId) || string.IsNullOrEmpty(run.project))
                {
                    return;
                }

                using (Process host = Process.GetProcessById(run.pid))
                {
                    long actualStart = new DateTimeOffset(host.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
                    // PID reuse must not make an abandoned record look like a live Agent.
                    if (!host.HasExited && Math.Abs(actualStart - run.hostStarted) <= 10)
                    {
                        runs.Add(run);
                    }
                }
            }
            catch (Exception exception) when (exception is IOException || exception is ArgumentException || exception is InvalidOperationException || exception is System.ComponentModel.Win32Exception || exception is UnauthorizedAccessException)
            {
                // A process may exit or remove its record between enumeration and inspection.
            }
        }

        /// <summary>
        /// Draws the most recent execution snapshot on the Unity Editor thread.
        /// </summary>
        public void Draw()
        {
            int sessions = runs.FindAll(run => !string.IsNullOrEmpty(run.threadId)).Count;
            EditorGUILayout.LabelField("Live Agents: " + sessions + "     Executions: " + runs.Count, EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Refreshes every second. Shows GameCLI executions for this Windows user across projects. Executions are current analysis jobs, not JIRA issue counts. Four role skills do not mean four running Agents.", MessageType.Info);
            if (error != null)
            {
                EditorGUILayout.HelpBox(error, MessageType.Warning);
            }

            if (runs.Count == 0)
            {
                GUILayout.Label("No active GameCLI Agent executions. Start GameCLI pm --analyze from a terminal.", EditorStyles.wordWrappedLabel);
            }

            foreach (Run run in runs)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    double elapsed = Math.Max(0, (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - run.started) / 1000.0);
                    string stage = string.IsNullOrEmpty(run.threadId) ? "Starting Codex" : string.IsNullOrEmpty(run.turnId) ? "Starting task" : "Running";
                    EditorGUILayout.LabelField(run.role + "  |  " + stage + "  |  " + TimeSpan.FromSeconds(elapsed).ToString(@"hh\:mm\:ss"), EditorStyles.boldLabel);
                    DrawValue("Project", run.project);
                    DrawValue("Execution", run.executionId);
                    DrawValue("Session", string.IsNullOrEmpty(run.threadId) ? "Waiting for Codex" : run.threadId);
                    DrawValue("Turn", string.IsNullOrEmpty(run.turnId) ? "Waiting for task" : run.turnId);
                    EditorGUILayout.LabelField("GameCLI PID", run.pid.ToString());
                }
            }
        }

        private static void DrawValue(string label, string value)
        {
            EditorGUILayout.LabelField(label, EditorStyles.miniBoldLabel);
            GUILayout.Label(value, EditorStyles.wordWrappedLabel);
        }

        [Serializable]
        private sealed class Run
        {
            public int version;

            public int pid;

            public long hostStarted;

            public long started;

            public string executionId;

            public string project;

            public string role;

            public string threadId;

            public string turnId;
        }
    }
}
