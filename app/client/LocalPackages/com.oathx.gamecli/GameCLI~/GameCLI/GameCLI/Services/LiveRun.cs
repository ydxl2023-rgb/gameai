using System.Diagnostics;
using System.Text.Json;

namespace GameCLI.Services
{
    internal sealed class LiveRun : IDisposable
    {
        private readonly string path;

        private readonly string project;

        private readonly string executionId;

        private readonly long hostStarted;

        private readonly long started = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        /// <summary>
        /// Publishes a transient record associated with this process ID and start time.
        /// </summary>
        public LiveRun(string project, string executionId)
        {
            this.project = project;
            this.executionId = executionId;
            using Process host = Process.GetCurrentProcess();
            hostStarted = new DateTimeOffset(host.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gamecli", "runs");
            Directory.CreateDirectory(directory);
            path = Path.Combine(directory, executionId + ".json");
            SetSession("", "");
        }

        /// <summary>
        /// Atomically replaces process-discovery metadata without persisting prompt or workflow state.
        /// </summary>
        public void SetSession(string threadId, string turnId)
        {
            // Ephemeral local process discovery only: no prompt, credentials or JIRA workflow state.
            string json = JsonSerializer.Serialize(new
            {
                version = 1,
                pid = Environment.ProcessId,
                hostStarted,
                started,
                executionId,
                project,
                role = "PM",
                threadId,
                turnId
            });
            string temporary = path + ".tmp";
            File.WriteAllText(temporary, json);
            File.Move(temporary, path, overwrite: true);
        }

        /// <summary>
        /// Attempts to remove the discovery record; stale records are rejected by the viewer.
        /// </summary>
        public void Dispose()
        {
            try
            {
                File.Delete(path);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // The viewer also validates PID plus start time, so stale records are never active work.
                Console.Error.WriteLine("Unable to remove local monitoring record; it will be ignored after process exit.");
            }
        }
    }
}
