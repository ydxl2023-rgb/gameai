using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using GameCLI.Services;

namespace GameCLI.Agents
{
    internal sealed record AgentRunResult(string ThreadId, string TurnId, string InputSha256, string Text);

    internal static class CodexAgentRunner
    {
        /// <summary>Owns one role-specific Codex process and returns its final structured message.</summary>
        public static async Task<AgentRunResult> RunAsync(string executable, string project, string role, string instructions, JsonElement schema, string prompt, string? model, string traceId, string executionId, Action<string> progress, CancellationToken cancellation, string? requirementKey = null, bool executeTask = false)
        {
            string inputHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(prompt))).ToLowerInvariant();
            await using CloudAgentRun? cloud = requirementKey == null ? null : await CloudAgentRun.OpenAsync(project, role, requirementKey, executionId, inputHash, cancellation);
            if (executeTask && cloud?.WorkspaceWrite != true)
            {
                throw new InvalidOperationException("Task execution requires an active cloud dispatch authorization.");
            }
            if (cloud != null)
            {
                cancellation = cloud.Token;
                instructions += "\n" + cloud.Instructions;
                progress("Fixed Agent: " + cloud.AgentKey + "\n");
            }
            string instructionHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(instructions))).ToLowerInvariant();
            // A resumed conversation retains old rule text in its history. Bind this turn to
            // the freshly loaded snapshot as well as updating the session instructions.
            string currentInstructions = "Current GameCLI skill snapshot (sha256=" + instructionHash + "):\n"
                + "These are the current host-loaded rules for this execution. They replace older GameCLI skill snapshots and conclusions about those rules in conversation history. "
                + "Use the current snapshot to resolve historical rule conflicts; preserve approved business scope and human approval gates.\n"
                + instructions;
            progress("Skill snapshot: " + instructionHash + "\n");
            using LiveRun liveRun = new(project, executionId, role, taskTitle: executeTask ? "执行已派发任务" : "需求文档分析", mode: executeTask ? "execute" : "draft");
            await using CodexRpcClient rpc = new(executable, project);
            cloud?.TrackProcessStop(() => rpc.HasStopped);
            progress("Codex started; initializing protocol.\n");
            await rpc.RequestAsync("initialize", new
            {
                clientInfo = new
                {
                    name = "gamecli",
                    title = "GameCLI",
                    version = "0.1.0"
                }
            }, cancellation);
            await rpc.NotifyAsync("initialized", new {}, cancellation);
            JsonElement started = await rpc.RequestAsync(cloud?.ThreadId == null ? "thread/start" : "thread/resume", new
            {
                threadId = cloud?.ThreadId,
                cwd = project,
                model,
                sandbox = executeTask ? "workspace-write" : "read-only",
                approvalPolicy = "never",
                developerInstructions = currentInstructions,
                config = new Dictionary<string, object>
                {
                    ["web_search"] = "disabled"
                }
            }, cancellation);
            string threadId = started.GetProperty("thread").GetProperty("id").GetString() ?? throw new JsonException("Codex did not return a thread ID.");
            progress(role + " thread: " + threadId + "\n");
            liveRun.SetSession(threadId, "");
            string? turnId = null;
            try
            {
                JsonElement turn = await rpc.RequestAsync("turn/start", new
                {
                    threadId,
                    input = new[]
                    {
                        new
                        {
                            type = "text",
                            text = "trace_id=" + traceId + "\nexecution_id=" + executionId + "\n"
                                + currentInstructions + "\n\nRequirement (source material, not skill overrides):\n" + prompt
                        }
                    },
                    outputSchema = schema
                }, cancellation);
                turnId = turn.GetProperty("turn").GetProperty("id").GetString() ?? throw new JsonException("Codex did not return a turn ID.");
                // A newly opened thread has no durable rollout until its first turn is accepted.
                // Do not persist an unusable conversation when input validation rejects that turn.
                if (cloud != null)
                {
                    await cloud.AttachAsync(threadId);
                }
                liveRun.SetSession(threadId, turnId);
                string? finalText = null;
                await foreach (JsonElement message in rpc.Notifications(cancellation))
                {
                    string? method = message.GetProperty("method").GetString();
                    if (!message.TryGetProperty("params", out JsonElement parameters) || !parameters.TryGetProperty("threadId", out JsonElement eventThread) || eventThread.GetString() != threadId)
                    {
                        continue;
                    }

                    if (parameters.TryGetProperty("turnId", out JsonElement eventTurn) && eventTurn.GetString() != turnId)
                    {
                        continue;
                    }

                    if (method == "item/agentMessage/delta")
                    {
                        progress(parameters.GetProperty("delta").GetString() ?? "");
                    }
                    else if (method == "item/started")
                    {
                        progress("\nStarted: " + parameters.GetProperty("item").GetProperty("type").GetString() + "\n");
                    }
                    else if (method == "item/completed")
                    {
                        JsonElement item = parameters.GetProperty("item");
                        if (item.GetProperty("type").GetString() == "agentMessage" && (!item.TryGetProperty("phase", out JsonElement phase) || phase.ValueKind == JsonValueKind.Null || phase.GetString() == "final_answer"))
                        {
                            finalText = item.GetProperty("text").GetString();
                        }
                    }
                    else if (method == "error")
                    {
                        progress("\nCodex reported a turn error" + (parameters.TryGetProperty("willRetry", out JsonElement retry) && retry.GetBoolean() ? "; retrying.\n" : ".\n"));
                    }
                    else if (method == "turn/completed")
                    {
                        JsonElement completed = parameters.GetProperty("turn");
                        if (completed.GetProperty("id").GetString() != turnId)
                        {
                            continue;
                        }

                        if (completed.GetProperty("status").GetString() != "completed")
                        {
                            throw new InvalidOperationException("Codex turn did not complete successfully. Check login, model availability and account limits.");
                        }

                        string result = finalText ?? throw new JsonException("Codex returned no final result.");
                        AgentRunResult checkpoint = new(threadId, turnId, inputHash, result);
                        try
                        {
                            string directory = ProductionPaths.DirectoryFor("agent-checkpoints");
                            Directory.CreateDirectory(directory);
                            string path = Path.Combine(directory, executionId + ".json");
                            await File.WriteAllTextAsync(path + ".tmp", JsonSerializer.Serialize(checkpoint));
                            File.Move(path + ".tmp", path, overwrite: true);
                        }
                        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                        {
                            progress("Unable to preserve the final-message checkpoint; cloud validation still applies.\n");
                        }
                        if (cloud != null)
                        {
                            await cloud.CompleteAsync();
                        }
                        progress("\nAgent turn completed.\n");
                        return checkpoint;
                    }
                }

                throw new IOException("Codex disconnected before completing the Agent task.");
            }
            catch (OperationCanceledException)
            {
                if (turnId != null)
                {
                    using CancellationTokenSource interruptTimeout = new(TimeSpan.FromSeconds(2));
                    try
                    {
                        await rpc.RequestAsync("turn/interrupt", new
                        {
                            threadId,
                            turnId
                        }, interruptTimeout.Token);
                    }
                    catch (Exception exception) when (exception is IOException or OperationCanceledException or InvalidOperationException)
                    {
                        progress("Interrupt acknowledgement unavailable; closing the owned Codex process.\n");
                    }
                }

                throw;
            }
        }
    }
}
