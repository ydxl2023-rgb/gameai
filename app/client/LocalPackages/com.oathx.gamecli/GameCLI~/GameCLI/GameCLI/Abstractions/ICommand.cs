namespace GameCLI.Abstractions
{
    public interface ICommand
    {
        string Name { get; }
        string Description { get; }
        Task<int> ExecuteAsync(string[] args, CancellationToken cancellationToken);
    }
}
