using System.Diagnostics;
using System.Text.Json.Nodes;
using GameCLI.Abstractions;

namespace GameCLI.Plugins.UiLibrary
{
    internal sealed class RestoreCommand : ICommand
    {
        public string Name => "restore";
        public string Description => "--version <database-version-id> --server <GameAI.Server> --project <UnityProject> --output <new-directory> [--dry-run] [--replace]";

        public async Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken)
        {
            Dictionary<string, string> options = new();
            bool dryRun = false;
            bool replace = false;
            for (int index = 0; index < args.Length; index++)
            {
                if (args[index] == "--dry-run")
                {
                    dryRun = true;
                }
                else if (args[index] == "--replace")
                {
                    replace = true;
                }
                else if (new[] { "--version", "--server", "--project", "--output" }.Contains(args[index]) && index + 1 < args.Length)
                {
                    options.Add(args[index], args[++index]);
                }
                else
                {
                    throw new ArgumentException("Unknown/incomplete restore option.");
                }
            }
            foreach (string key in new[] { "--version", "--server", "--project", "--output" })
            {
                if (!options.ContainsKey(key))
                {
                    throw new ArgumentException(Description);
                }
            }
            string version = options["--version"];
            if (!long.TryParse(version, out long number) || number <= 0)
            {
                throw new ArgumentException("Invalid database version ID.");
            }
            string project = Path.GetFullPath(options["--project"]);
            string server = Path.GetFullPath(options["--server"]);
            string output = Path.GetFullPath(options["--output"]);
            if (Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
            {
                throw new ArgumentException("Output directory must be empty; prior run evidence is preserved.");
            }
            string cli = Path.Combine(project, "Library", "UnityCLI", "UnityCLI.exe");
            if (!File.Exists(cli))
            {
                throw new ArgumentException("UnityCLI is not installed in target project.");
            }
            string assetRoot = "Assets/GameAI/UiLibrary/Version" + version;
            string prefab = assetRoot + "/UITemplate" + version + ".prefab";
            if (File.Exists(Path.Combine(project, prefab)) && !replace && !dryRun)
            {
                throw new ArgumentException("Prefab already exists; use --replace explicitly.");
            }
            JsonArray steps = new();
            JsonObject result = new() { ["success"] = false, ["versionId"] = version, ["prefab"] = prefab, ["dryRun"] = dryRun, ["steps"] = steps };
            // Preparation owns a new output directory; never overwrite another run's evidence.
            JsonObject plan = await Run("node", server, new[] { Path.Combine(server, "scripts", "ui-library.mjs"), "prepare-restore", version, output, assetRoot }, cancellationToken);
            if (!Directory.Exists(output) || !File.Exists(Path.Combine(output, "plan.json")))
            {
                Console.WriteLine(plan.ToJsonString());
                return 2;
            }
            result["plan"] = plan.DeepClone();
            try
            {
                if (plan["success"]?.GetValue<bool>() != true)
                {
                    throw new InvalidOperationException("Visual evidence is incomplete; see plan blockers.");
                }
                if (!dryRun)
                {
                    foreach (JsonNode? import in plan["imports"]!.AsArray())
                    {
                        string target = import!["target"]!.ToString();
                        string existing = Path.Combine(project, target);
                        if (File.Exists(existing))
                        {
                            string digest = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(await File.ReadAllBytesAsync(existing, cancellationToken))).ToLowerInvariant();
                            if (digest != import["sha256"]!.ToString())
                            {
                                throw new InvalidOperationException("Existing target asset differs: " + target);
                            }
                            continue;
                        }
                        await Unity(new[] { "asset", "import", "--src", import["file"]!.ToString(), "--dst", target });
                    }
                    bool exists = File.Exists(Path.Combine(project, prefab));
                    List<string> command = new() { "prefab", "restore", "--json", plan["snapshot"]!.ToString(), "--prefab", prefab };
                    if (exists)
                    {
                        command.Add("--replace");
                    }
                    await Unity(command.Concat(new[] { "--dry-run" }).ToArray());
                    await Unity(command.ToArray());
                    JsonObject inspected = await Unity(new[] { "prefab", "inspect", "--prefab", prefab, "--recursive" });
                    JsonNode? data = inspected["data"];
                    if ((data?["missingScriptCount"]?.GetValue<int>() ?? 0) > 0 || (data?["missingReferenceCount"]?.GetValue<int>() ?? 0) > 0)
                    {
                        throw new InvalidOperationException("Restored prefab contains missing references.");
                    }
                    if (!File.Exists(Path.Combine(output, "preview.png")))
                    {
                        throw new InvalidOperationException("Unity did not produce a visual preview.");
                    }
                }
                if (!dryRun)
                {
                    JsonObject registered = await Run("node", server, new[] { Path.Combine(server, "scripts", "ui-library.mjs"), "register-preview", version, Path.Combine(output, "preview.png") }, cancellationToken);
                    result["previewRegistration"] = registered;
                    if (registered["success"]?.GetValue<bool>() != true)
                    {
                        throw new InvalidOperationException("Prefab restored, but preview registration failed; see report.");
                    }
                }
                result["success"] = true;
                result["status"] = dryRun ? "prepared-only" : plan["warnings"]!.AsArray().Count > 0 ? "restored-with-warnings" : "restored";
                result["requiresReview"] = plan["warnings"]!.AsArray().Count > 0;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                result["error"] = error.Message;
            }
            await File.WriteAllTextAsync(Path.Combine(output, "result.json"), result.ToJsonString(new() { WriteIndented = true }), cancellationToken);
            string encoded = System.Net.WebUtility.HtmlEncode(result.ToJsonString(new() { WriteIndented = true }));
            string html = "<!doctype html><meta charset=utf-8><title>UI 模板静态重建</title><style>body{font:16px/1.6 sans-serif;max-width:1100px;margin:32px auto}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>UI 模板静态重建 · " + version + "</h1><p>静态外观重建。保留原始动态文案，未执行源业务脚本；存在警告时仍需人工复核。</p><nav><a href=#preview>效果预览</a> | <a href=#report>执行报告</a></nav><h2 id=preview>Unity 实际渲染</h2>" + (File.Exists(Path.Combine(output, "preview.png")) ? "<img src=preview.png>" : "<p>本轮未生成预览。</p>") + "<h2 id=report>执行证据与缺项</h2><pre>" + encoded + "</pre>";
            await File.WriteAllTextAsync(Path.Combine(output, "index.html"), html, cancellationToken);
            Console.WriteLine(result.ToJsonString());
            return result["success"]!.GetValue<bool>() ? 0 : 2;

            async Task<JsonObject> Unity(string[] command)
            {
                Console.Error.WriteLine("UnityCLI: " + string.Join(' ', command.Take(2)));
                JsonObject response = await Run(cli, project, new[] { "--project", project, "--format", "json" }.Concat(command), cancellationToken);
                steps.Add(new JsonObject { ["command"] = string.Join(' ', command), ["response"] = response.DeepClone() });
                if (response["ok"]?.GetValue<bool>() != true)
                {
                    throw new InvalidOperationException("UnityCLI failed; inspect result steps before retrying.");
                }
                return response;
            }
        }

        private static async Task<JsonObject> Run(string executable, string directory, IEnumerable<string> arguments, CancellationToken cancellation)
        {
            ProcessStartInfo start = new(executable) { WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (string argument in arguments)
            {
                start.ArgumentList.Add(argument);
            }
            // Font import can take minutes. The child bridge uses the same bounded response timeout.
            start.Environment["UNITYCLI_REQUEST_TIMEOUT_SECONDS"] = "180";
            using Process process = Process.Start(start) ?? throw new InvalidOperationException("Cannot start adapter.");
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromMinutes(4));
            try
            {
                Task<string> stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
                Task<string> stderr = process.StandardError.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                string text = await stdout;
                string errors = await stderr;
                if (string.IsNullOrWhiteSpace(text))
                {
                    return new JsonObject { ["success"] = false, ["ok"] = false, ["error"] = errors, ["exitCode"] = process.ExitCode };
                }
                return JsonNode.Parse(text)!.AsObject();
            }
            catch (OperationCanceledException)
            {
                if (!process.HasExited)
                {
                    process.Kill(true);
                }
                throw;
            }
        }
    }
}
