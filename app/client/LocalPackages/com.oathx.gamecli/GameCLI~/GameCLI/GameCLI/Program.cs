using GameCLI.Commands;

namespace GameCLI
{
    internal static class Program
    {
        private static Task<int> Main(string[] args)
        {
            if (args.Length == 0 || (args.Length == 1 && (args[0] == "--help" || args[0] == "-h")))
            {
                Console.WriteLine("Usage: GameCLI <group> [options]");
                Console.WriteLine("Groups:");
                Console.WriteLine("  unity    Unity Editor commands (use unity --help)");
                return Task.FromResult(0);
            }

            // Route by capability before parsing group-specific operations and options.
            switch (args[0])
            {
                case "unity":
                    return UnityCommand.RunAsync(args[1..]);
                default:
                    Console.Error.WriteLine("Unknown command group: " + args[0] + ". Use GameCLI --help.");
                    return Task.FromResult(4);
            }
        }
    }
}
