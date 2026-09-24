using System.Text;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Formats human-readable execution evidence without replacing requirement descriptions.</summary>
    internal static class ExecutionComment
    {
        public static string Delivery(string role, TaskDelivery delivery)
        {
            StringBuilder text = Header(role, delivery.Status == "submitted" ? "交付已提交，完成状态以任务门禁为准" : "执行未通过或已中断", delivery.ThreadId, delivery.TurnId);
            text.AppendLine("* 执行次数：" + delivery.Attempts);
            text.AppendLine("* 需求版本：" + delivery.Revision);
            text.AppendLine("h3. 执行摘要");
            text.AppendLine("* " + Line(delivery.Status == "failed" ? delivery.FailureSummary : delivery.Result?.Summary));
            if (delivery.Result != null)
            {
                text.AppendLine("h3. 产物清单");
                foreach (DeliveryArtifact artifact in (delivery.Result.Artifacts ?? Array.Empty<DeliveryArtifact>()).Where(item => item != null))
                {
                    text.AppendLine("* " + Line(artifact.Path) + "：" + Line(artifact.Purpose));
                    text.AppendLine("** 校验值：" + Line(artifact.Sha256));
                }

                text.AppendLine("h3. 检查结果");
                foreach (DeliveryCheck check in (delivery.Result.Checks ?? Array.Empty<DeliveryCheck>()).Where(item => item != null))
                {
                    text.AppendLine("* " + Line(check.Name));
                    text.AppendLine("** 代理报告：" + (check.Passed ? "通过" : "未通过"));
                    text.AppendLine("** 证据路径：" + Line(check.EvidencePath));
                }
            }

            text.AppendLine("h3. 后续处理");
            text.AppendLine("* " + (delivery.Status == "failed" ? "核对原因与现有执行记录后显式重试，不自动重启代理。" : role == "Art" ? "等待美术人工抽检；通过并完成美术子任务后才能开始依赖它的程序任务。" : role == "Development" ? "由编排器再次核对交付与依赖，再处理程序完成转换和验收调度。" : "等待用户最终验收。"));
            return Limit(text.ToString());
        }

        public static string Probe(AgentProbe probe)
        {
            StringBuilder text = Header(probe.Role, probe.Status == "completed" ? "只读联调完成，未制作资源或编写代码" : "只读联调未通过或已中断", probe.ThreadId, probe.TurnId);
            text.AppendLine("h3. 任务接收结果");
            text.AppendLine("* " + Line(probe.Status == "completed" ? probe.Result?.Summary : probe.FailureSummary));
            text.AppendLine("h3. 后续计划产物（尚未执行）");
            foreach (string output in probe.Result?.PlannedOutputs ?? Array.Empty<string>())
            {
                text.AppendLine("* " + Line(output));
            }

            text.AppendLine("* 本评论不代表正式交付、需求批准或任务完成。");
            return Limit(text.ToString());
        }

        private static StringBuilder Header(string role, string outcome, string thread, string turn)
        {
            StringBuilder text = new();
            text.AppendLine("h3. 代理执行结果");
            text.AppendLine("* 执行角色：" + JiraIssueDescription.Role(role));
            text.AppendLine("* 执行结果：" + outcome);
            text.AppendLine("* 会话编号：" + Line(thread));
            text.AppendLine("* 轮次编号：" + Line(turn));
            return text;
        }

        private static string Limit(string text)
        {
            if (Encoding.UTF8.GetByteCount(text) <= 22000)
            {
                return text;
            }

            int end = Math.Min(text.Length, 7000);
            end = text.LastIndexOf('\n', end - 1);
            return text[..Math.Max(0, end)] + "\n* 清单较长，评论仅展示前部分；完整结果请查看该任务的交付属性与证据文件。";
        }

        private static string Line(string? value)
        {
            string line = string.IsNullOrWhiteSpace(value) ? "无" : value.Replace('\r', ' ').Replace('\n', ' ');
            return line.Length <= 2000 ? line : line[..2000] + "（内容较长，完整内容见执行记录）";
        }
    }
}
