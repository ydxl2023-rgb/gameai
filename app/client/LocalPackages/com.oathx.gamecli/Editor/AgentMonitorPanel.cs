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

        private string selectedExecution;

        private Vector2 tableScroll;

        /// <summary>
        /// Refreshes transient execution records and filters out exited or reused process IDs.
        /// </summary>
        public void Refresh(string project)
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
                    ReadRun(path, project);
                }

                runs.Sort((left, right) => left.started.CompareTo(right.started));
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                error = "无法读取本机运行记录，请检查目录访问权限。";
            }
        }

        private void ReadRun(string path, string project)
        {
            try
            {
                Run run = JsonUtility.FromJson<Run>(File.ReadAllText(path));
                if (run == null || run.version != 1 || run.pid <= 0 || run.started <= 0 || string.IsNullOrEmpty(run.executionId) || string.IsNullOrEmpty(run.project))
                {
                    return;
                }

                if (!string.Equals(Path.GetFullPath(run.project).TrimEnd('\\', '/'), Path.GetFullPath(project).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
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
        public void Draw(string role)
        {
            List<Run> visible = runs.FindAll(run => role == null || string.Equals(run.role, role, StringComparison.OrdinalIgnoreCase));
            if (error != null)
            {
                EditorGUILayout.HelpBox(error, MessageType.Warning);
            }

            tableScroll = EditorGUILayout.BeginScrollView(tableScroll, GUILayout.ExpandHeight(true));
            using (new EditorGUILayout.VerticalScope(GUILayout.MinWidth(770)))
            {
                using (new EditorGUILayout.HorizontalScope(EditorStyles.toolbar))
                {
                    Cell("角色", 105, true);
                    Cell("JIRA 任务", 115, true);
                    Cell("正在处理的工作", 235, true);
                    Cell("运行状态", 100, true);
                    Cell("执行模式", 90, true);
                    Cell("已运行", 85, true);
                    Cell("详情", 40, true);
                }

                foreach (Run run in visible)
                {
                    DrawRow(run);
                }

                if (visible.Count == 0)
                {
                    GUILayout.Label(role == null ? "当前没有正在工作的 Agent。" : "当前没有正在工作的 " + role + " Agent。", EditorStyles.centeredGreyMiniLabel);
                }
            }

            Run selected = visible.Find(run => run.executionId == selectedExecution);
            if (selected != null)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    DrawValue("执行编号", selected.executionId);
                    DrawValue("会话编号", selected.threadId);
                    DrawValue("轮次编号", selected.turnId);
                    DrawValue("进程编号", selected.pid.ToString());
                    if (GUILayout.Button("复制任务与执行信息"))
                    {
                        EditorGUIUtility.systemCopyBuffer = selected.role + " | " + selected.issueKey + "\n" + selected.taskTitle + "\n" + selected.executionId + "\n" + selected.threadId + "\n" + selected.turnId;
                    }
                }
            }
            EditorGUILayout.EndScrollView();
        }

        private void DrawRow(Run run)
        {
            using (new EditorGUILayout.HorizontalScope(EditorStyles.helpBox, GUILayout.Height(24)))
            {
                Cell(run.role, 101);
                Cell(string.IsNullOrEmpty(run.issueKey) ? "未关联 / 旧版记录" : run.issueKey, 115);
                Cell(string.IsNullOrEmpty(run.taskTitle) ? "未提供任务标题" : run.taskTitle, 235);
                string stage = string.IsNullOrEmpty(run.threadId) ? "启动会话" : string.IsNullOrEmpty(run.turnId) ? "准备任务" : "工作中";
                GUIStyle stateStyle = new GUIStyle(EditorStyles.label);
                stateStyle.normal.textColor = string.IsNullOrEmpty(run.turnId) ? new Color(0.9f, 0.65f, 0.2f) : new Color(0.2f, 0.75f, 0.4f);
                GUILayout.Label(stage, stateStyle, GUILayout.Width(100));
                Cell(run.mode == "probe" ? "只读联调" : run.mode == "draft" ? "需求草案" : string.IsNullOrEmpty(run.mode) ? "未标注" : "正式执行", 90);
                TimeSpan elapsed = TimeSpan.FromMilliseconds(Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - run.started));
                Cell(((int)elapsed.TotalHours).ToString("00") + elapsed.ToString(@"\:mm\:ss"), 85);
                if (GUILayout.Button(selectedExecution == run.executionId ? "收起" : "查看", EditorStyles.miniButton, GUILayout.Width(40)))
                {
                    selectedExecution = selectedExecution == run.executionId ? null : run.executionId;
                }
            }
        }

        private static void Cell(string value, float width, bool header = false)
        {
            GUILayout.Label(new GUIContent(value ?? "", value ?? ""), header ? EditorStyles.miniBoldLabel : EditorStyles.label, GUILayout.Width(width));
        }

        private static void DrawValue(string label, string value)
        {
            EditorGUILayout.LabelField(label, EditorStyles.miniBoldLabel);
            GUILayout.Label(string.IsNullOrEmpty(value) ? "等待创建" : value, EditorStyles.wordWrappedLabel);
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

            public string issueKey;

            public string taskTitle;

            public string mode;

            public string threadId;

            public string turnId;
        }
    }
}
