using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    internal sealed partial class JiraWorkflowStore
    {
        /// <summary>Pins the reviewed HTML bytes before recording approval.</summary>
        public static async Task<RequirementAttachment> PrepareAttachmentAsync(string revision, string? path, CancellationToken cancellation)
        {
            if (string.IsNullOrWhiteSpace(path) || !string.Equals(Path.GetExtension(path), ".html", StringComparison.OrdinalIgnoreCase))
            {
                throw new JiraTaskException("必须提供已审阅的 HTML 文件：--attachment <文件路径>。", 4);
            }

            FileInfo file = new(path);
            if (!file.Exists || file.Length is < 1 or > 5 * 1024 * 1024)
            {
                throw new JiraTaskException("需求附件不存在、为空或超过 5MB。", 4);
            }

            byte[] bytes = await File.ReadAllBytesAsync(path, cancellation);
            if (!Encoding.UTF8.GetString(bytes).Contains(revision, StringComparison.Ordinal))
            {
                throw new JiraTaskException("需求附件未包含当前完整 revision，请重新生成对应版本文档。", 4);
            }

            string hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            return new RequirementAttachment
            {
                Revision = revision,
                Sha256 = hash,
                FileName = "requirement-" + revision + "-" + hash + ".html"
            };
        }

        /// <summary>Persists each attempt before POST and reconciles uncertain responses before retrying.</summary>
        public async Task EnsureAttachmentAsync(Workflow state, string? path, CancellationToken cancellation)
        {
            RequirementAttachment receipt = RequireAttachment(state);
            if (await FindAttachmentAsync(state, cancellation))
            {
                state.Stage = "pm_pending";
                await SaveAsync(state, cancellation);
                return;
            }

            if (receipt.Attempts >= 3)
            {
                state.Stage = "attachment_failed";
                await SaveAsync(state, cancellation);
                throw new JiraTaskException("需求附件上传已尝试 3 次且未核验成功，停止启动 PM。", 3);
            }

            RequirementAttachment local = await PrepareAttachmentAsync(state.Revision, path, cancellation);
            if (local.Sha256 != receipt.Sha256)
            {
                throw new JiraTaskException("附件内容已变化，不能替换已批准文件；请重新审阅需求。", 3);
            }

            byte[] bytes = await File.ReadAllBytesAsync(path!, cancellation);
            if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != receipt.Sha256)
            {
                throw new JiraTaskException("读取附件期间文件发生变化。", 3);
            }

            while (receipt.Attempts < 3)
            {
                cancellation.ThrowIfCancellationRequested();
                // Recheck immediately before every POST; a lost response may already have stored the file.
                if (await FindAttachmentAsync(state, cancellation))
                {
                    break;
                }

                receipt.Attempts++;
                state.Stage = "attachment_pending";
                await SaveAsync(state, cancellation);
                Console.Error.WriteLine("上传需求附件，第 " + receipt.Attempts + "/3 次。");
                try
                {
                    guard();
                    using HttpRequestMessage request = JiraTaskClient.Request(HttpMethod.Post, connection.Address + "/rest/api/2/issue/" + state.IssueKey + "/attachments", connection.Token);
                    request.Headers.Add("X-Atlassian-Token", "no-check");
                    using MultipartFormDataContent content = new();
                    ByteArrayContent file = new(bytes);
                    file.Headers.ContentType = new MediaTypeHeaderValue("text/html");
                    content.Add(file, "file", receipt.FileName);
                    request.Content = content;
                    using HttpResponseMessage response = await http.SendAsync(request, cancellation);
                    // The issue attachment list and downloaded bytes, not this response, establish success.
                    if (!response.IsSuccessStatusCode)
                    {
                        Console.Error.WriteLine("附件上传返回 HTTP " + (int)response.StatusCode + "，核对远端后再决定重试。");
                    }
                }
                catch (HttpRequestException)
                {
                    Console.Error.WriteLine("附件上传连接异常，先核对远端结果。");
                }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    Console.Error.WriteLine("附件上传响应超时，先核对远端结果。");
                }

                // If verification itself fails, stop without issuing another uncertain POST.
                if (await FindAttachmentAsync(state, cancellation))
                {
                    break;
                }

                if (receipt.Attempts < 3)
                {
                    await Task.Delay(TimeSpan.FromSeconds(receipt.Attempts), cancellation);
                }
            }

            state.Stage = receipt.Id == null ? "attachment_failed" : "pm_pending";
            await SaveAsync(state, cancellation);
            if (receipt.Id == null)
            {
                throw new JiraTaskException("需求附件上传 3 次均未核验成功，PM 未启动，未创建子任务。", 3);
            }
        }

        /// <summary>Verifies the approved bytes still exist on the parent before PM or any child POST.</summary>
        public async Task VerifyAttachmentAsync(Workflow state, CancellationToken cancellation)
        {
            RequirementAttachment receipt = RequireAttachment(state);
            if (receipt.Id == null || !await FindAttachmentAsync(state, cancellation))
            {
                throw new JiraTaskException("当前需求附件尚未核验成功或已被删除，禁止 PM 建单。", 3);
            }
        }

        private static RequirementAttachment RequireAttachment(Workflow state)
        {
            RequirementAttachment? receipt = state.Attachment;
            if (receipt == null || receipt.Revision != state.Revision || state.ApprovedRevision != state.Revision || receipt.Attempts is < 0 or > 3 || receipt.Sha256.Length != 64 || receipt.FileName != "requirement-" + state.Revision + "-" + receipt.Sha256 + ".html")
            {
                throw new JiraTaskException("缺少与批准版本绑定的有效附件记录，禁止 PM 建单。", 3);
            }

            return receipt;
        }

        private async Task<bool> FindAttachmentAsync(Workflow state, CancellationToken cancellation)
        {
            RequirementAttachment receipt = RequireAttachment(state);
            JsonElement issue = await SendAsync(HttpMethod.Get, "issue/" + state.IssueKey + "?fields=attachment", null, cancellation);
            JsonElement list = issue.GetProperty("fields").GetProperty("attachment");
            foreach (JsonElement attachment in list.EnumerateArray())
            {
                if (attachment.GetProperty("filename").GetString() != receipt.FileName)
                {
                    continue;
                }

                Uri address = new(attachment.GetProperty("content").GetString()!, UriKind.Absolute);
                Uri origin = new(connection.Address);
                if (address.Scheme != origin.Scheme || address.Host != origin.Host || address.Port != origin.Port || address.UserInfo.Length > 0)
                {
                    throw new JiraTaskException("附件下载地址不属于当前 JIRA，停止发送认证信息。", 3);
                }

                guard();
                using HttpRequestMessage request = JiraTaskClient.Request(HttpMethod.Get, address.AbsoluteUri, connection.Token);
                using HttpResponseMessage response = await http.SendAsync(request, cancellation);
                response.EnsureSuccessStatusCode();
                byte[] bytes = await response.Content.ReadAsByteArrayAsync(cancellation);
                if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != receipt.Sha256)
                {
                    throw new JiraTaskException("JIRA 附件内容与批准文件不一致，停止建单。", 3);
                }

                receipt.Id = attachment.GetProperty("id").GetString();
                receipt.Url = address.AbsoluteUri;
                return !string.IsNullOrWhiteSpace(receipt.Id);
            }

            receipt.Id = null;
            receipt.Url = null;
            return false;
        }
    }
}
