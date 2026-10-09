using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

/// <summary>Provides a local lease endpoint without touching platform data or credentials.</summary>
internal sealed class FakeCloud : IAsyncDisposable
{
    private readonly HttpListener listener = new();
    private readonly Task serving;
    private string? threadId;

    public string Project
    { get; } = Path.Combine(Path.GetTempPath(), "gamecli-cloud-test-" + Guid.NewGuid().ToString("N"));

    public FakeCloud()
    {
        TcpListener reservation = new(IPAddress.Loopback, 0);
        reservation.Start();
        int port = ((IPEndPoint)reservation.LocalEndpoint).Port;
        reservation.Stop();
        string address = "http://127.0.0.1:" + port + "/";
        listener.Prefixes.Add(address);
        listener.Start();
        Directory.CreateDirectory(Path.Combine(Project, ".gamecli"));
        File.WriteAllText(Path.Combine(Project, ".gamecli", "client.json"), JsonSerializer.Serialize(new
        {
            server = address,
            worker_key = "test-worker",
            token = "test-only"
        }));
        serving = ServeAsync();
    }

    private async Task ServeAsync()
    {
        try
        {
            while (listener.IsListening)
            {
                HttpListenerContext context = await listener.GetContextAsync();
                using JsonDocument request = await JsonDocument.ParseAsync(context.Request.InputStream);
                string? action = request.RootElement.GetProperty("action").GetString();
                if (action == "attach")
                {
                    threadId = request.RootElement.GetProperty("thread_id").GetString();
                }
                string response = action == "claim"
                    ? JsonSerializer.Serialize(new
                    {
                        agent_key = "pm-test",
                        thread_id = threadId,
                        instructions = ""
                    })
                    : "{\"state\":\"completed\"}";
                byte[] bytes = Encoding.UTF8.GetBytes(response);
                context.Response.ContentType = "application/json";
                await context.Response.OutputStream.WriteAsync(bytes);
                context.Response.Close();
            }
        }
        catch (HttpListenerException) when (!listener.IsListening)
        {
            // Disposing the fixture interrupts the pending accept.
        }
        catch (ObjectDisposedException)
        {
            // The listener has already been closed by fixture cleanup.
        }
    }

    public async ValueTask DisposeAsync()
    {
        listener.Close();
        await serving;
        Directory.Delete(Project, true);
    }
}
