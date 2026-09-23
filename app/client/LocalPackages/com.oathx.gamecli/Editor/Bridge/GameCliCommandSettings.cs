using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

using UnityEditor;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Keeps Editor command preferences in a locked cache for background pipe readers.
    /// </summary>
    public static class GameCliCommandSettings
    {
        private static readonly object sync = new object();

        private static readonly Dictionary<string, bool> enabledRoutes = new Dictionary<string, bool>();

        private static string preferencePrefix;

        // Initialize and mutate on the editor thread; the pipe worker reads only the locked cache.
        /// <summary>Loads per-project preferences on the Unity Editor thread.</summary>
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
            lock (sync)
            {
                preferencePrefix = prefix;
                enabledRoutes.Clear();
                enabledRoutes.Add("/ping", pingEnabled);
            }
        }

        /// <summary>Reads the thread-safe cache; unknown routes are disabled.</summary>
        public static bool IsEnabled(string route)
        {
            lock (sync)
            {
                return enabledRoutes.TryGetValue(route, out bool enabled) && enabled;
            }
        }

        /// <summary>Persists a known route's preference on the Editor thread and updates the cache.</summary>
        /// <exception cref="InvalidOperationException">The route has not been initialized.</exception>
        public static void SetEnabled(string route, bool enabled)
        {
            lock (sync)
            {
                if (preferencePrefix == null || !enabledRoutes.ContainsKey(route))
                {
                    throw new InvalidOperationException("Command settings have not been initialized for this route.");
                }

                // This is local editor configuration, not JIRA workflow state.
                EditorPrefs.SetBool(preferencePrefix + route, enabled);
                enabledRoutes[route] = enabled;
            }
        }
    }
}
