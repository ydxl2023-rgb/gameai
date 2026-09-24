using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

using UnityEditor;
using UnityEditor.IMGUI.Controls;
using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    internal sealed class AgentMonitorPanel
    {
        private readonly List<Run> runs = new List<Run>();

        private string error;

        private string selectedExecution;

        private Vector2 detailScroll;

        private AgentTable table;

        private int snapshotVersion;

        private int displayedVersion = -1;

        private string displayedRole;

        /// <summary>
        /// Refreshes transient execution records and filters out exited or reused process IDs.
        /// </summary>
        public void Refresh(string project)
        {
            snapshotVersion++;
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

            if (table == null)
            {
                table = new AgentTable(this);
            }

            if (displayedVersion != snapshotVersion || displayedRole != role)
            {
                table.SetRuns(visible);
                displayedVersion = snapshotVersion;
                displayedRole = role;
            }

            Rect tableRect = GUILayoutUtility.GetRect(0, 100000, 0, 100000, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));
            table.OnGUI(tableRect);

            Run selected = visible.Find(run => run.executionId == selectedExecution);
            if (selected != null)
            {
                detailScroll = EditorGUILayout.BeginScrollView(detailScroll, GUILayout.Height(130));
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
                EditorGUILayout.EndScrollView();
            }
        }

        /// <summary>
        /// Uses Unity's native table controls without coupling monitoring to the RPC package.
        /// </summary>
        private sealed class AgentTable : TreeView
        {
            private readonly AgentMonitorPanel owner;

            private readonly Dictionary<string, int> rowIds = new Dictionary<string, int>();

            private List<Run> rows = new List<Run>();

            private int nextId = 1;

            public AgentTable(AgentMonitorPanel owner)
                : base(new TreeViewState(), CreateHeader())
            {
                this.owner = owner;
                rowHeight = 20;
                showAlternatingRowBackgrounds = true;
                showBorder = true;
                multiColumnHeader.sortingChanged += header => Reload();
                Reload();
            }

            public void SetRuns(List<Run> current)
            {
                rows = current;
                HashSet<string> active = new HashSet<string>();
                foreach (Run run in rows)
                {
                    active.Add(run.executionId);
                    if (!rowIds.ContainsKey(run.executionId))
                    {
                        rowIds.Add(run.executionId, nextId++);
                    }
                }

                // Keep identities stable across refresh and sorting, but discard ended executions.
                foreach (string id in new List<string>(rowIds.Keys))
                {
                    if (!active.Contains(id))
                    {
                        rowIds.Remove(id);
                    }
                }

                Reload();
            }

            private static MultiColumnHeader CreateHeader()
            {
                string[] labels =
                {
                    "Role",
                    "Task ID",
                    "Status",
                    "Mode",
                    "Elapsed",
                    "Details"
                };
                float[] widths =
                {
                    95,
                    90,
                    70,
                    75,
                    70,
                    55
                };
                var columns = new MultiColumnHeaderState.Column[labels.Length];
                for (int index = 0; index < columns.Length; index++)
                {
                    columns[index] = new MultiColumnHeaderState.Column
                    {
                        headerContent = new GUIContent(labels[index]),
                        width = widths[index],
                        minWidth = index == 5 ? 45 : 55,
                        autoResize = index == 1,
                        canSort = index != 5,
                        allowToggleVisibility = false
                    };
                }

                return new MultiColumnHeader(new MultiColumnHeaderState(columns));
            }

            protected override TreeViewItem BuildRoot()
            {
                var root = new TreeViewItem(0, -1, "Root")
                {
                    children = new List<TreeViewItem>()
                };
                List<Run> sorted = new List<Run>(rows);
                int column = multiColumnHeader.sortedColumnIndex;
                sorted.Sort((left, right) => CompareRuns(left, right, column));
                foreach (Run run in sorted)
                {
                    root.AddChild(new AgentRow(rowIds[run.executionId], run));
                }

                return root;
            }

            private int CompareRuns(Run left, Run right, int column)
            {
                int order;
                if (column < 0 || column == 4)
                {
                    // Elapsed time is compared numerically, independent of the display format.
                    order = column < 0 ? left.started.CompareTo(right.started) : right.started.CompareTo(left.started);
                }
                else
                {
                    order = StringComparer.OrdinalIgnoreCase.Compare(Value(left, column), Value(right, column));
                }

                if (column >= 0 && !multiColumnHeader.IsSortedAscending(column))
                {
                    order = -order;
                }

                return order == 0 ? StringComparer.Ordinal.Compare(left.executionId, right.executionId) : order;
            }

            protected override void RowGUI(RowGUIArgs args)
            {
                Run run = ((AgentRow)args.item).Run;
                for (int index = 0; index < args.GetNumVisibleColumns(); index++)
                {
                    int column = args.GetColumn(index);
                    Rect cell = args.GetCellRect(index);
                    CenterRectUsingSingleLineHeight(ref cell);
                    cell.xMin += 4;
                    cell.xMax -= 4;
                    if (column == 5)
                    {
                        if (GUI.Button(cell, owner.selectedExecution == run.executionId ? "收起" : "查看", EditorStyles.miniButton))
                        {
                            owner.selectedExecution = owner.selectedExecution == run.executionId ? null : run.executionId;
                        }
                    }
                    else
                    {
                        GUIStyle style = new GUIStyle(EditorStyles.label);
                        if (column == 2)
                        {
                            style.normal.textColor = string.IsNullOrEmpty(run.turnId) ? new Color(0.9f, 0.65f, 0.2f) : new Color(0.2f, 0.75f, 0.4f);
                        }

                        string value = Value(run, column);
                        GUI.Label(cell, new GUIContent(value, value), style);
                    }
                }
            }

            private static string Value(Run run, int column)
            {
                switch (column)
                {
                    case 0:
                        return run.role ?? "";
                    case 1:
                        return string.IsNullOrEmpty(run.issueKey) ? "—" : run.issueKey;
                    case 2:
                        return string.IsNullOrEmpty(run.threadId) ? "启动会话" : string.IsNullOrEmpty(run.turnId) ? "准备任务" : "工作中";
                    case 3:
                        return run.mode == "probe" ? "只读联调" : run.mode == "draft" ? "需求草案" : string.IsNullOrEmpty(run.mode) ? "未标注" : "正式执行";
                    case 4:
                        TimeSpan elapsed = TimeSpan.FromMilliseconds(Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - run.started));
                        return ((int)elapsed.TotalHours).ToString("00") + elapsed.ToString(@"\:mm\:ss");
                    default:
                        return "";
                }
            }

            protected override bool CanMultiSelect(TreeViewItem item)
            {
                return false;
            }

            private sealed class AgentRow : TreeViewItem
            {
                public Run Run
                { get; }

                public AgentRow(int id, Run run) : base(id, 0, run.taskTitle ?? "")
                {
                    Run = run;
                }
            }
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
