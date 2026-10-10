using System.ComponentModel;
using System.Text;
using System.Text.Json;

using GameCLI.Abstractions;
using GameCLI.Agents;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Plugins.PM
{
    /// <summary>Executes a cloud-requested PM proposal using the fixed PM conversation.</summary>
    internal sealed class PmPlanCommand : ICommand
    {
        public string Name => "plan";

        public string Description => "Enrich the cloud UI delivery skeleton for validated publication.";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            const string Usage = "GameCLI pm plan --project <repository> --key <requirement> --execution-id <32 hex> --prompt-file <file> --skills <directory> [--codex <executable>]";
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            try
            {
                Dictionary<string, string> values = new(StringComparer.Ordinal);
                for (int i = 0; i < args.Length; i += 2)
                {
                    if (i + 1 >= args.Length || args[i] is not ("--project" or "--key" or "--execution-id" or "--prompt-file" or "--skills" or "--codex") || !values.TryAdd(args[i], args[i + 1]))
                    {
                        throw new ArgumentException(Usage);
                    }
                }

                foreach (string key in new[]
                {
                    "--project",
                    "--key",
                    "--execution-id",
                    "--prompt-file",
                    "--skills"
                })
                {
                    if (!values.ContainsKey(key))
                    {
                        throw new ArgumentException(Usage);
                    }
                }

                string executionId = values["--execution-id"];
                if (!System.Text.RegularExpressions.Regex.IsMatch(executionId, "^[0-9a-f]{32}$"))
                {
                    throw new ArgumentException("Invalid execution ID.");
                }

                string project = Path.GetFullPath(values["--project"]);
                string prompt = await File.ReadAllTextAsync(values["--prompt-file"], new UTF8Encoding(false, true), cancellationToken);
                if (string.IsNullOrWhiteSpace(prompt) || Encoding.UTF8.GetByteCount(prompt) > 6 * 1024 * 1024)
                {
                    throw new ArgumentException("PM input is empty or too large.");
                }

                // One fixed PM combines its UI and Art planning modules in one conversation.
                string instructions = "当前仅由 RodFergusson 执行。读取云端固定骨架和完整批准 HTML，使用 UI 与 Art 模块补充每项 title、description、acceptance 及计划 summary。必须原样返回骨架的 id、role、source_refs、depends_on；窗口和阶段由 id 固定，不增删任务，不按控件拆单，不生成 Development 或 QA。若原文与清单矛盾或范围未定，停止并报告错误，不返回虚构的成功计划。不改文件、不建单、不调用其他 PM。严格使用 schema。";
                using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromMinutes(15));
                AgentRunResult result = await CodexAgentRunner.RunAsync(values.GetValueOrDefault("--codex", "codex"), project, "PM", instructions, PmPlanContract.Schema, prompt, null, Guid.NewGuid().ToString("N"), executionId, value => Console.Error.Write(value), timeout.Token, values["--key"]);
                using JsonDocument plan = JsonDocument.Parse(result.Text);
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    execution_id = executionId,
                    thread_id = result.ThreadId,
                    turn_id = result.TurnId,
                    input_sha256 = result.InputSha256,
                    plan = plan.RootElement
                }));
                return 0;
            }
            catch (Exception error) when (error is ArgumentException or IOException or InvalidOperationException or JsonException or OperationCanceledException or Win32Exception or UnauthorizedAccessException or CodexInteractionException or HttpRequestException)
            {
                Console.Error.WriteLine(error is OperationCanceledException ? "PM plan cancelled or timed out." : error.Message);
                return error is ArgumentException ? 4 : 3;
            }
        }
    }
}
