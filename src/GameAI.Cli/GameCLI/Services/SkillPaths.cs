namespace GameCLI.Services
{
    /// <summary>Resolves platform skills without depending on a Unity or target-project layout.</summary>
    internal static class SkillPaths
    {
        public static string Resolve()
        {
            string? configured = Environment.GetEnvironmentVariable("GAMEAI_SKILLS_DIR");
            if (!string.IsNullOrWhiteSpace(configured))
            {
                return Path.GetFullPath(configured);
            }

            for (DirectoryInfo? directory = new(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
            {
                string candidate = Path.Combine(directory.FullName, "skills");
                if (File.Exists(Path.Combine(candidate, "gameai-common", "SKILL.md")))
                {
                    return candidate;
                }
            }

            throw new DirectoryNotFoundException("Platform skills not found. Set GAMEAI_SKILLS_DIR or supply --skills.");
        }
    }
}
