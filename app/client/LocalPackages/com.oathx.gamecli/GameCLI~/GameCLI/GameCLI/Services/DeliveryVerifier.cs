using System.Security.Cryptography;
using System.Text.RegularExpressions;

using GameCLI.Contracts;

namespace GameCLI.Services
{
    /// <summary>Verifies local delivery integrity. Semantic acceptance remains a JIRA review decision.</summary>
    internal sealed class DeliveryVerifier
    {
        private readonly string project;

        public DeliveryVerifier(string project)
        {
            this.project = Path.GetFullPath(project);
        }

        /// <summary>Requires real nonempty files with matching hashes and attached passing-check evidence.</summary>
        public async Task VerifyAsync(DeliveryResult result, CancellationToken cancellation)
        {
            WorkflowContract.RequireText(result.Summary, 2000);
            if (result.Verdict != "pass" || result.Artifacts == null || result.Artifacts.Length is < 1 or > 100 || result.Checks == null || result.Checks.Length is < 1 or > 100)
            {
                throw new JiraTaskException("交付未通过或缺少产物、检查证据。", 3);
            }

            HashSet<string> paths = new(StringComparer.OrdinalIgnoreCase);
            foreach (DeliveryArtifact artifact in result.Artifacts)
            {
                if (artifact == null || !Regex.IsMatch(artifact.Sha256 ?? "", "^[a-f0-9]{64}$"))
                {
                    throw new JiraTaskException("交付文件缺少有效哈希。", 3);
                }

                WorkflowContract.RequireText(artifact.Purpose, 500);
                string path = Resolve(artifact.Path);
                if (!paths.Add(path))
                {
                    throw new JiraTaskException("交付文件重复。", 3);
                }

                using FileStream file = new(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (file.Length == 0 || Convert.ToHexString(await SHA256.HashDataAsync(file, cancellation)).ToLowerInvariant() != artifact.Sha256)
                {
                    throw new JiraTaskException("交付文件为空或哈希已变化：" + artifact.Path, 3);
                }
            }

            foreach (DeliveryCheck check in result.Checks)
            {
                if (check == null || !check.Passed || !paths.Contains(Resolve(check.EvidencePath)))
                {
                    throw new JiraTaskException("检查未通过或证据不属于本次交付。", 3);
                }

                WorkflowContract.RequireText(check.Name, 500);
            }
        }

        private string Resolve(string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || relative.Length > 500 || Path.IsPathRooted(relative) || relative.Contains(':'))
            {
                throw new JiraTaskException("交付路径必须位于当前工程内并使用相对路径。", 3);
            }

            string[] parts = relative.Replace('\\', '/').Split('/');
            if (parts.Any(part => part is "" or "." or ".." || new[]
            {
                ".git",
                ".codex",
                ".gamecli",
                "Library",
                "Temp",
                "obj",
                "bin",
                "jira.txt"
            }.Contains(part, StringComparer.OrdinalIgnoreCase)))
            {
                throw new JiraTaskException("交付路径包含禁止的目录或文件。", 3);
            }

            string path = project;
            foreach (string part in parts)
            {
                path = Path.Combine(path, part);
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                {
                    throw new JiraTaskException("交付路径不能经过符号链接或目录联接。", 3);
                }
            }

            return path;
        }
    }
}
