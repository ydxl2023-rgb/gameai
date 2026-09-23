using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GameCLI.Services
{
    /// <summary>
    /// Stores per-user CLI enablement preferences without storing JIRA workflow state.
    /// </summary>
    public sealed class PluginSettingsStore
    {
        private readonly string path;

        /// <summary>Selects a preference file, defaulting to the current user's .gamecli directory.</summary>
        public PluginSettingsStore(string? path = null)
        {
            this.path = Path.GetFullPath(path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "plugins.json"));
        }

        /// <summary>Reads persisted overrides, returning an empty map when no file exists.</summary>
        /// <exception cref="JsonException">The preference file does not contain a valid override map.</exception>
        public Dictionary<string, bool> Read()
        {
            return File.Exists(path) ? JsonSerializer.Deserialize<Dictionary<string, bool>>(File.ReadAllText(path)) ?? throw new JsonException("Invalid plugin settings.") : new(StringComparer.Ordinal);
        }

        /// <summary>Serializes updates across CLI processes and atomically replaces the preference file.</summary>
        /// <exception cref="IOException">The settings lock cannot be acquired or persistence fails.</exception>
        public void SetEnabled(string id, bool enabled)
        {
            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path.ToUpperInvariant())));
            using Mutex mutex = new(false, "GameCLI.Plugins." + hash);
            bool acquired;
            try
            {
                acquired = mutex.WaitOne(TimeSpan.FromSeconds(5));
            }
            catch (AbandonedMutexException)
            {
                acquired = true;
            }

            if (!acquired)
            {
                throw new IOException("Plugin settings are busy.");
            }

            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                // Serialize preference updates across CLI processes; never store workflow state here.
                Dictionary<string, bool> values = Read();
                values[id] = enabled;
                Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new IOException("Invalid settings path."));
                File.WriteAllText(temporary, JsonSerializer.Serialize(values, new JsonSerializerOptions
                {
                    WriteIndented = true
                }));
                File.Move(temporary, path, overwrite: true);
            }
            finally
            {
                mutex.ReleaseMutex();
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }
        }
    }
}
