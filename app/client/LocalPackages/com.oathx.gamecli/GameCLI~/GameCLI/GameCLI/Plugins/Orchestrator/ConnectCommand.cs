using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using GameCLI.Abstractions;
using GameCLI.Contracts;
using GameCLI.Services;

namespace GameCLI.Plugins.Orchestrator
{
    /// <summary>Receives JIRA event hints through the coordination server without independently dispatching agents.</summary>
    internal sealed class ConnectCommand : ICommand
    {
        public string Name => "connect";

        public string Description => "连接 GameCLIServer，接收项目的 JIRA 状态事件。";

        private const string Usage = "GameCLI orchestrator --connect --server <ws://host:port/ws> --project-key <KEY> [--client-id <id>] [--max-events <count>] [--timeout <seconds>] [--format human|json]";

        /// <inheritdoc />
        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            // The long-lived JSON stream must have one encoding regardless of the Windows console code page.
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] is "--help" or "-h")
            {
                Console.WriteLine(Usage);
                return 0;
            }

            using CancellationTokenSource stop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            bool interrupted = false;
            ConsoleCancelEventHandler cancel = (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                interrupted = true;
                stop.Cancel();
            };
            Console.CancelKeyPress += cancel;
            try
            {
                Dictionary<string, string> options = Parse(args);
                if (!Uri.TryCreate(options.GetValueOrDefault("--server"), UriKind.Absolute, out Uri? address) || address.Scheme is not ("ws" or "wss") || address.AbsolutePath != "/ws" || address.Query != "" || address.Fragment != "" || address.UserInfo != "")
                {
                    throw new ArgumentException("服务地址必须是无查询参数和凭据的 ws:// 或 wss:// 地址，路径为 /ws。");
                }

                string project = options.GetValueOrDefault("--project-key", "");
                string clientId = options.GetValueOrDefault("--client-id", "gamecli-" + Guid.NewGuid().ToString("N"));
                if (!Regex.IsMatch(project, "^[A-Z][A-Z0-9_]{0,63}$") || !Regex.IsMatch(clientId, "^[a-zA-Z0-9_.-]{1,100}$"))
                {
                    throw new ArgumentException("项目编号或客户端编号无效。");
                }

                int maximum = ReadNumber(options, "--max-events", 1000000);
                int timeout = ReadNumber(options, "--timeout", 86400);
                if (timeout > 0)
                {
                    stop.CancelAfter(TimeSpan.FromSeconds(timeout));
                }

                PluginSettingsStore preferences = new();
                void Guard()
                {
                    if (!preferences.Read().GetValueOrDefault("orchestrator", true))
                    {
                        throw new InvalidOperationException("编排器插件已禁用，停止事件连接。");
                    }
                }

                ServerEventClient client = new(address, project, clientId, Guard);
                bool json = options.GetValueOrDefault("--format", "human") == "json";
                await client.RunAsync((envelope, _) =>
                {
                    Console.WriteLine(json ? WorkflowContract.Serialize(envelope) : HumanMessage(envelope));
                    return Task.CompletedTask;
                }, maximum, stop.Token);
                return 0;
            }
            catch (OperationCanceledException)
            {
                Console.Error.WriteLine(interrupted || cancellationToken.IsCancellationRequested ? "事件连接已停止。" : "事件监听已超时。");
                return interrupted || cancellationToken.IsCancellationRequested ? 0 : 1;
            }
            catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or JsonException or KeyNotFoundException)
            {
                int code = exception is ArgumentException or JsonException or InvalidDataException or KeyNotFoundException ? 4 : 3;
                string message = exception is JsonException or KeyNotFoundException ? "服务器消息字段无效。" : exception.Message;
                Console.WriteLine(WorkflowContract.Serialize(new
                {
                    ok = false,
                    exit_code = code,
                    message
                }));
                return code;
            }
            finally
            {
                Console.CancelKeyPress -= cancel;
            }
        }

        private static string HumanMessage(ServerEnvelope envelope)
        {
            if (envelope.Type == "worker.registered")
            {
                return envelope.Payload.GetProperty("resync_required").GetBoolean() ? "已连接事件服务；需要重新核对 JIRA，当前通知不代表完整任务快照。" : "已重新连接，正在恢复遗漏通知。";
            }

            return envelope.Type == "jira.issue_changed" ? "收到 JIRA 单据事件：" + envelope.Payload.GetProperty("issue_key").GetString() + "；事件序号：" + envelope.Payload.GetProperty("sequence").GetInt64() : "事件连接中断，等待重连。";
        }

        private static Dictionary<string, string> Parse(string[] args)
        {
            HashSet<string> allowed = new()
            {
                "--server",
                "--project-key",
                "--client-id",
                "--max-events",
                "--timeout",
                "--format"
            };
            Dictionary<string, string> result = new(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2)
            {
                if (index + 1 >= args.Length || !allowed.Contains(args[index]) || string.IsNullOrWhiteSpace(args[index + 1]) || args[index + 1].StartsWith("--", StringComparison.Ordinal) || !result.TryAdd(args[index], args[index + 1]))
                {
                    throw new ArgumentException(Usage);
                }
            }

            if (result.GetValueOrDefault("--format", "human") is not ("human" or "json"))
            {
                throw new ArgumentException(Usage);
            }

            return result;
        }

        private static int ReadNumber(Dictionary<string, string> options, string name, int maximum)
        {
            if (!int.TryParse(options.GetValueOrDefault(name, "0"), out int value) || value < 0 || value > maximum)
            {
                throw new ArgumentException("参数无效：" + name);
            }

            return value;
        }
    }
}
