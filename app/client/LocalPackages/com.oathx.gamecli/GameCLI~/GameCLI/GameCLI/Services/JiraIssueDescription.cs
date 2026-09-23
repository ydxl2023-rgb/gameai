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
                Section(text, "专业执行顺序", new[]
                {
                    design.ArtRequirements.Length > 0 ? "美术设计与资源交付并审核完成后，程序方可开始实现。" : "本需求无美术前置任务，需求获批后进入程序开发。",
                    "程序交付校验完成后，编排器自动完成程序子任务，验收代理针对同一交付版本执行测试。",
                    "验收代理提交报告与证据，由用户进行最终验收。"
                });
                Section(text, "交付门禁", new[]
                {
                    "编排器重新读取前置子任务的完成状态、文件路径、哈希和检查证据，满足全部条件后才启动下游。",
                    "上游重新打开、文件变化或交付版本更新时，下游旧交付不能继续放行。"
                });
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
            Section(text, "启动条件", new[]
            {
                "所属需求的当前版本已获批准。",
                task.DependsOn.Length == 0 ? "本任务无专业前置任务。" : "所有前置子任务均已完成，交付文件存在、哈希一致，检查证据齐全。",
                "编排器启动前重新读取单据与交付版本；上游返工、文件变化或版本失效时停止放行。"
            });
            Section(text, "交付要求", task.Role switch
            {
                "Art" => new[]
            {
                "提交界面设计、布局与尺寸、触屏交互说明、资源文件及预览、导入设置。",
                "程序必须使用通过审核的美术交付版本，不能凭文字描述自行替代美术设计。"
            },
                "Development" => new[]
            {
                "提交实际代码和界面资源、构建结果、功能检查报告，并记录使用的美术交付版本。",
                "编译通过不等于功能验收通过。"
            },
                _ => new[]
            {
                "针对指定程序及美术交付版本逐项执行验收，提交测试报告与证据。",
                "未执行或缺少证据的用例不能判定通过；最终验收由用户完成。"
            }
            });
            Section(text, "交付确认", new[]
            {
                "交付清单记录工程相对路径、文件哈希、检查证据与输入版本。",
                task.Role == "Development" ? "程序代理提交后，由编排器核验交付并完成子任务，再启动验收，不增加人工程序审批。" : "代理提交后先检查实际交付，再将本子任务设为完成；美术抽检与最终验收由用户确认。",
                "返工先重新打开子任务；修改上游后，下游必须重新核验并按需返工。"
            });
            return text.ToString().TrimEnd();
        }

        /// <summary>Separates reported execution evidence from unexecuted acceptance criteria.</summary>
        public static string Delivery(TaskDelivery delivery)
        {
            StringBuilder text = new("\n\n");
            Section(text, "实际交付记录", new[]
            {
                delivery.Status == "submitted" ? "已提交交付，按本任务交付确认规则推进；实际完成状态以单据为准。" : delivery.Status == "running" ? "专业代理正在执行。" : "执行未通过，需要处理后重试。",
                "执行编号：" + delivery.ExecutionId,
                "交付版本：" + (delivery.Version.Length == 0 ? "尚未生成" : delivery.Version)
            });
            if (delivery.Result != null)
            {
                Section(text, "交付说明", new[]
                {
                    delivery.Result.Summary
                });
                Section(text, "交付文件", delivery.Result.Artifacts.Select(item => item.Path + "；文件哈希：" + item.Sha256));
                Section(text, "实际检查证据", delivery.Result.Checks.Select(item => item.Name + "：" + (item.Passed ? "代理报告通过" : "未通过") + "；证据路径：" + item.EvidencePath));
            }

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
