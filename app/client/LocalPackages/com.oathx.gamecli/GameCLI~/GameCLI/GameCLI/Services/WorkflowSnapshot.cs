using System.IO.Compression;
using System.Text;
using System.Text.Json;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Losslessly stores large snapshots within one atomic JIRA property.</summary>
    internal static class WorkflowSnapshot
    {
        private const int MaximumBytes = 1048576;

        public static string Encode(Workflow state)
        {
            string json = WorkflowContract.Serialize(state);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            if (bytes.Length > MaximumBytes)
            {
                throw new JsonException("工作流快照超过 1MB，请拆分需求。");
            }

            if (bytes.Length <= 32000)
            {
                return json;
            }

            using MemoryStream buffer = new();
            using (GZipStream compressor = new(buffer, CompressionLevel.SmallestSize, true))
            {
                compressor.Write(bytes);
            }

            string envelope = WorkflowContract.Serialize(new
            {
                encoding = "gzip-base64-v1",
                sha256 = WorkflowContract.Hash(json),
                data = Convert.ToBase64String(buffer.ToArray())
            });
            if (Encoding.UTF8.GetByteCount(envelope) > 32000)
            {
                throw new JsonException("压缩后的工作流快照仍超过 JIRA 属性容量，请拆分需求。");
            }

            return envelope;
        }

        public static Workflow Decode(string json)
        {
            using JsonDocument document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("encoding", out JsonElement encoding))
            {
                return WorkflowContract.Parse<Workflow>(json);
            }

            if (encoding.GetString() != "gzip-base64-v1" || Encoding.UTF8.GetByteCount(json) > 32000)
            {
                throw new JsonException("不支持的工作流快照编码或大小。");
            }

            byte[] compressed = Convert.FromBase64String(document.RootElement.GetProperty("data").GetString()!);
            using MemoryStream input = new(compressed);
            using GZipStream decompressor = new(input, CompressionMode.Decompress);
            using MemoryStream output = new();
            byte[] buffer = new byte[8192];
            int count;
            // Bound decompression before allocating an untrusted snapshot.
            while ((count = decompressor.Read(buffer)) > 0)
            {
                if (output.Length + count > MaximumBytes)
                {
                    throw new JsonException("工作流快照解压后超过大小限制。");
                }

                output.Write(buffer, 0, count);
            }

            string expanded = new UTF8Encoding(false, true).GetString(output.ToArray());
            if (WorkflowContract.Hash(expanded) != document.RootElement.GetProperty("sha256").GetString())
            {
                throw new JsonException("工作流快照完整性校验失败。");
            }

            return WorkflowContract.Parse<Workflow>(expanded);
        }
    }
}
