namespace GameCLI.Abstractions
{
    public interface ICLIPlugin
    {
        string Id { get; }
        string Description { get; }
        bool IsEnabled { get; }
        IReadOnlyList<ICommand> Commands { get; }
        void Enable();
        void Disable();
    }
}
