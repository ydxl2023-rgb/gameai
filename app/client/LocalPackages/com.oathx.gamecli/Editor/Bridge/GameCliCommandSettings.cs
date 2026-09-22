using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;

namespace Oathx.GameCLI.Editor
{
    public static class GameCliCommandSettings
    {
        private static readonly object Sync = new object();
        private static readonly Dictionary<string, bool> Enabled = new Dictionary<string, bool>();
        private static string preferencePrefix;

        // Initialize and mutate on the editor thread; the pipe worker reads only the locked cache.
        public static void Initialize(string projectPath)
        {
            string normalized = Path.GetFullPath(projectPath).TrimEnd(Path.DirectorySeparatorChar);
            if (Path.DirectorySeparatorChar == '\\')
            {
                normalized = normalized.ToUpperInvariant();
            }

            string projectHash;
            using (SHA256 hash = SHA256.Create())
            {
                projectHash = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(normalized))).Replace("-", "");
            }

            string prefix = "GameCLI.Commands." + projectHash + ".";
            if (preferencePrefix == prefix)
            {
                return;
            }

            bool pingEnabled = EditorPrefs.GetBool(prefix + "/ping", true);
            lock (Sync)
            {
                preferencePrefix = prefix;
                Enabled.Clear();
                Enabled.Add("/ping", pingEnabled);
            }
        }

        public static bool IsEnabled(string route)
        {
            lock (Sync)
            {
                return Enabled.TryGetValue(route, out bool enabled) && enabled;
            }
        }

        public static void SetEnabled(string route, bool enabled)
        {
            lock (Sync)
            {
                if (preferencePrefix == null || !Enabled.ContainsKey(route))
                {
                    throw new InvalidOperationException("Command settings have not been initialized for this route.");
                }

                // This is local editor configuration, not JIRA workflow state.
                EditorPrefs.SetBool(preferencePrefix + route, enabled);
                Enabled[route] = enabled;
            }
        }
    }
}
