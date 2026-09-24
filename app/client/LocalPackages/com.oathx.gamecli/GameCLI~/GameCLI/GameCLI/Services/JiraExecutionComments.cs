using System.Text;
using System.Text.Json;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    internal sealed partial class JiraWorkflowStore
    {
        /// <summary>Publishes one execution comment under the caller's single-writer lock, reconciling ambiguous POSTs.</summary>
        public async Task PublishExecutionCommentAsync(string issue, string executionId, string body, CancellationToken cancellation)
        {
            ValidateKey(issue);
            if (!Guid.TryParseExact(executionId, "N", out _) || Encoding.UTF8.GetByteCount(body) > 24000)
            {
                throw new ArgumentException("执行评论编号或长度无效。");
            }

            string path = "issue/" + issue + "/properties/gamecli.comment." + executionId;
            JsonElement saved = await SendAsync(HttpMethod.Get, path, null, cancellation, true);
            string marker = "执行编号：" + executionId;
            string content = body.TrimEnd() + "\n\n" + marker;
            string status = "prepared";
            if (saved.ValueKind != JsonValueKind.Undefined)
            {
                JsonElement receipt = saved.GetProperty("value");
                status = receipt.GetProperty("status").GetString()!;
                content = receipt.GetProperty("body").GetString()!;
                if (status == "posted")
                {
                    return;
                }

                if (status is not ("prepared" or "sending"))
                {
                    throw new JiraTaskException("评论回执状态无效，请核对单据。", 3);
                }
            }

            if (status == "sending")
            {
                string? existing = await FindExecutionCommentAsync(issue, marker, cancellation);
                if (existing == null)
                {
                    throw new JiraTaskException("执行评论投递结果尚未确认，停止重复发布，请核对单据评论：" + issue, 3, true);
                }

                await SaveAsync("posted", existing, cancellation);
                return;
            }

            // The outbox belongs to JIRA. A failed or uncertain send cannot authorize a second POST.
            await SaveAsync("sending", null, cancellation);
            JsonElement created;
            try
            {
                created = await SendAsync(HttpMethod.Post, "issue/" + issue + "/comment", JsonSerializer.Serialize(new
                {
                    body = content
                }), cancellation);
            }
            catch (JiraTaskException exception) when (!exception.OutcomeUnknown && exception.ExitCode is 2 or 3)
            {
                // A definite permission/field rejection did not create a comment; repair can retry the same execution.
                using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(5));
                await SaveAsync("prepared", null, deadline.Token);
                throw;
            }

            string id = created.GetProperty("id").GetString() ?? throw new JsonException("JIRA 未返回评论编号。");
            await SaveAsync("posted", id, cancellation);
            Console.Error.WriteLine("执行结果已写入 JIRA 评论：" + issue + "；评论编号：" + id);

            Task<JsonElement> SaveAsync(string nextStatus, string? id, CancellationToken token)
            {
                string snapshot = WorkflowContract.Serialize(new
                {
                    status = nextStatus,
                    comment_id = id,
                    body = content
                });
                if (Encoding.UTF8.GetByteCount(snapshot) > 30000)
                {
                    throw new JiraTaskException("评论投递记录超过容量。", 4);
                }

                return SendAsync(HttpMethod.Put, path, snapshot, token);
            }
        }

        private async Task<string?> FindExecutionCommentAsync(string issue, string marker, CancellationToken cancellation)
        {
            int start = 0;
            while (start < 10000)
            {
                JsonElement page = await SendAsync(HttpMethod.Get, "issue/" + issue + "/comment?startAt=" + start + "&maxResults=100", null, cancellation);
                JsonElement[] comments = page.GetProperty("comments").EnumerateArray().ToArray();
                foreach (JsonElement comment in comments)
                {
                    if ((comment.GetProperty("body").GetString() ?? "").Replace("\r\n", "\n").Split('\n').Contains(marker, StringComparer.Ordinal))
                    {
                        return comment.GetProperty("id").GetString();
                    }
                }

                start += comments.Length;
                if (start >= page.GetProperty("total").GetInt32())
                {
                    return null;
                }

                if (comments.Length == 0)
                {
                    break;
                }
            }

            throw new JiraTaskException("评论列表未能完整核对，停止重复发布。", 3);
        }
    }
}
