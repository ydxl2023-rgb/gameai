using System.Text;
using System.Text.RegularExpressions;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Builds the human-readable projection without exposing workflow storage data.</summary>
    internal static class JiraIssueDescription
    {
        /// <summary>Uses the design title when available and a bounded source title during analysis.</summary>
        public static string Title(Workflow state) => state.Design?.Title ?? "需求分析：" + state.Document.Replace('\r', ' ').Replace('\n', ' ')[..Math.Min(100, state.Document.Length)];

        /// <summary>Translates protocol role names for issue readers.</summary>
        public static string Role(string role) => role switch
        {
            "Art" => "美术",
            "Development" => "程序",
            "QA" => "测试验收",
            _ => throw new ArgumentException("Unsupported task role.")
        };

        /// <summary>Projects the latest state, keeping proposals separate from the design.</summary>
        public static string Workflow(Workflow state)
        {
            StringBuilder text = new();
            string status = state.Stage switch
            {
                "needs_clarification" => "需求整理中",
                "awaiting_approval" => "待用户确认策划方案",
                "tasks_created" => "专业任务单据已创建，尚不代表开发或验收完成",
                "design_failed" => "策划分析失败，等待处理或恢复",
                "pm_failed" => "专业任务整理或发布失败，等待处理或恢复",
                "outcome_unknown" => "建单结果待核实，禁止重复创建",
                _ => state.ApprovedRevision == null ? "策划分析中，尚未批准" : "方案已批准，正在组织专业任务"
            };
            Section(text, "当前状态", new[]
            {
                status
            });
            Section(text, "目标平台", new[]
            {
                "移动端，使用触屏点击和拖动操作。"
            });
            if (state.Design is DesignBrief design)
            {
                Section(text, "开发内容与规则", new[]
                {
                    design.Specification
                });
                Section(text, "程序开发内容", design.DevelopmentRequirements);
                Section(text, "美术开发内容", design.ArtRequirements);
                TestCases(text, design.Acceptance);
            }
            else
            {
                Section(text, "开发内容与规则", new[]
                {
                    "等待策划分析，分析后补充开发内容、规则及测试用例。"
                });
            }

            if (state.ArtCreated != null)
            {
                Section(text, "美术需求单据", new[]
                {
                    state.ArtCreated.Key + "：" + state.ArtCreated.Url
                });
            }

            Section(text, "程序与测试单据", state.EarlyTasks.Where(item => item.Created != null).Select(item => Role(item.Task.Role) + "：" + item.Created!.Key + " " + item.Created.Url));
            if (state.Created.Count > 0)
            {
                Section(text, "已创建的专业任务", state.Created.Select(task => task.Key + "：" + task.Url));
            }

            return text.ToString().TrimEnd();
        }

        /// <summary>Lists task scope, planned checks and resolved dependencies in Chinese.</summary>
        public static string Task(Workflow state, PlannedTask task, string workflowUrl)
        {
            StringBuilder text = new();
            Section(text, "任务归属", new[]
            {
                "负责专业：" + Role(task.Role),
                "所属需求：" + workflowUrl
            });
            Section(text, "开发内容与规则", new[]
            {
                task.Description
            });
            TestCases(text, task.Acceptance);
            Section(text, "前置依赖", task.DependsOn.Select(id => state.Created.Find(item => item.Id == id)?.Key ?? state.EarlyTasks.Find(item => item.Task.Id == id)?.Created?.Key ?? (state.ArtCreated?.Id == id ? state.ArtCreated.Key : id)));
            return text.ToString().TrimEnd();
        }

        private static void Section(StringBuilder text, string title, IEnumerable<string> items)
        {
            string[] values = items.SelectMany(value => value.Split('\n', StringSplitOptions.RemoveEmptyEntries)).Where(IsPublishable).ToArray();
            if (values.Length == 0)
            {
                return;
            }

            text.AppendLine("h3. " + title);
            foreach (string value in values)
            {
                foreach (string line in value.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                {
                    text.AppendLine("* " + line.Trim().TrimStart('*', '-').TrimStart());
                }
            }

            text.AppendLine();
        }

        private static bool IsPublishable(string text)
        {
            return !Regex.IsMatch(text, "待澄清|待确认|待明确|待确定|仍待|规则确认后|确认后的|确认规则|确认的|随.*确定|以.*为准|右键|鼠标|电脑端|桌面端");
        }

        private static void TestCases(StringBuilder text, IEnumerable<string> cases)
        {
            string[] values = cases.Where(IsPublishable).ToArray();
            if (values.Length == 0)
            {
                return;
            }

            text.AppendLine("h3. 测试用例与验收标准（尚未执行）");
            for (int index = 0; index < values.Length; index++)
            {
                string[] parts = Regex.Split(values[index], @"[；;\r\n]+");
                List<KeyValuePair<string, string>> fields = new();
                foreach (string part in parts.Where(part => !string.IsNullOrWhiteSpace(part)))
                {
                    Match field = Regex.Match(part.Trim().TrimStart('*', '-').Trim(), @"^(用例名称|前置条件|操作步骤|操作|预期结果|预期)[：:](.*)$");
                    string label = field.Success ? field.Groups[1].Value : "验收要求";
                    label = label == "操作" ? "操作步骤" : label == "预期" ? "预期结果" : label;
                    fields.Add(new KeyValuePair<string, string>(label, field.Success ? field.Groups[2].Value.Trim() : part.Trim()));
                }

                string? name = fields.FirstOrDefault(field => field.Key == "用例名称").Value;
                text.AppendLine("* 用例 " + (index + 1) + (name == null ? "" : "：" + name));
                foreach (IGrouping<string, KeyValuePair<string, string>> group in fields.Where(field => field.Key != "用例名称").GroupBy(field => field.Key))
                {
                    text.AppendLine("** " + group.Key);
                    foreach (KeyValuePair<string, string> field in group)
                    {
                        text.AppendLine("*** " + field.Value);
                    }
                }
            }

            text.AppendLine();
        }
    }
}
