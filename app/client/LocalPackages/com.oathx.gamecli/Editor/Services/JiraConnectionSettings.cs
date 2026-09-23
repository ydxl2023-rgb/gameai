using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Stores public JIRA connection metadata; the serialized address field retains its existing JSON name.
    /// </summary>
    [Serializable]
    public sealed class JiraConnectionSettings
    {
        public string address = "";

        /// <summary>Returns a validated copy with a normalized HTTP(S) base address.</summary>
        /// <exception cref="ArgumentException">The address contains unsupported URI components or is invalid.</exception>
        public JiraConnectionSettings Normalized()
        {
            if (!Uri.TryCreate((address ?? "").Trim(), UriKind.Absolute, out Uri uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            {
                throw new ArgumentException("Enter a valid HTTP(S) JIRA base address without embedded credentials, query or fragment.");
            }

            return new JiraConnectionSettings
            {
                address = uri.AbsoluteUri.TrimEnd('/')
            };
        }

        /// <summary>Gets the credential-store key derived from the normalized server address and Bearer scheme.</summary>
        public string CredentialTarget
        {
            get
            {
                JiraConnectionSettings settings = Normalized();
                // Preserve existing Bearer credential targets without reusing former Basic credentials.
                string identity = settings.address + "\n\nBearer";
                using (SHA256 hash = SHA256.Create())
                {
                    return "GameCLI/Jira/" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "");
                }
            }
        }
    }

    /// <summary>
    /// Persists public JIRA settings separately from the Windows credential store.
    /// </summary>
    public static class JiraSettingsStore
    {
        /// <summary>Gets the default per-user public connection settings path.</summary>
        public static string ConfigPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "jira.json");

        /// <summary>Loads normalized settings, or returns an empty configuration when the file is absent.</summary>
        public static JiraConnectionSettings Load(string configPath = null)
        {
            configPath = configPath ?? ConfigPath;
            if (!File.Exists(configPath))
            {
                return new JiraConnectionSettings();
            }

            JiraConnectionSettings settings = JsonUtility.FromJson<JiraConnectionSettings>(File.ReadAllText(configPath));
            if (settings == null)
            {
                throw new InvalidDataException("JIRA connection settings are invalid.");
            }

            return settings.Normalized();
        }

        /// <summary>Writes the token to Windows credentials, then atomically replaces public metadata.</summary>
        /// <remarks>The credential and metadata stores are separate; a metadata failure does not roll back the credential write.</remarks>
        public static void Save(JiraConnectionSettings settings, string secret, string configPath = null)
        {
            configPath = configPath ?? ConfigPath;
            settings = settings.Normalized();
            if (string.IsNullOrWhiteSpace(secret) || secret.Contains("\r") || secret.Contains("\n"))
            {
                throw new ArgumentException("Enter a credential before saving.");
            }

            // Only connection metadata goes to disk. Workflow state remains in JIRA.
            WindowsCredentialStore.Write(settings.CredentialTarget, secret);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(configPath)));
            string temporary = configPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, JsonUtility.ToJson(settings, true), new UTF8Encoding(false));
                if (File.Exists(configPath))
                {
                    File.Replace(temporary, configPath, null);
                }
                else
                {
                    File.Move(temporary, configPath);
                }
            }
            finally
            {
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }
        }
    }
}
