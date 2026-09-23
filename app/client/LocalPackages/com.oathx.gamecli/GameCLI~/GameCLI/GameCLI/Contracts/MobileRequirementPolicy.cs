using System.Text.Json;
using System.Text.RegularExpressions;

namespace GameCLI.Contracts
{
    /// <summary>Rejects desktop interaction assumptions before publishing agent-generated requirements.</summary>
    internal static class MobileRequirementPolicy
    {
        public static void Validate(DesignBrief design)
        {
            ValidateText(string.Join("\n", new[]
            {
                design.Title,
                design.Specification
            }.Concat(design.Acceptance).Concat(design.ArtRequirements).Concat(design.DevelopmentRequirements)));
        }

        public static void Validate(TaskPlan plan)
        {
            foreach (PlannedTask task in plan.Tasks)
            {
                ValidateText(task.Title + "\n" + task.Description + "\n" + string.Join("\n", task.Acceptance));
            }
        }

        private static void ValidateText(string text)
        {
            if (Regex.IsMatch(text, @"右键|鼠标|电脑端|桌面端|键盘|\bPC\b|right[- ]click|mouse", RegexOptions.IgnoreCase))
            {
                throw new JsonException("需求仅支持移动端触屏操作，请移除桌面交互方案后重新分析。");
            }
        }
    }
}
