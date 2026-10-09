namespace GameCLI.Services
{
    /// <summary>Keeps intermediate execution files separate from final project deliverables.</summary>
    internal static class ProductionPaths
    {
        public static string DirectoryFor(string category)
        {
            string platform = Path.GetDirectoryName(SkillPaths.Resolve())
                ?? throw new DirectoryNotFoundException("Platform directory not found.");
            string directory = Path.Combine(platform, "temp", category);
            Directory.CreateDirectory(directory);
            return directory;
        }
    }
}
