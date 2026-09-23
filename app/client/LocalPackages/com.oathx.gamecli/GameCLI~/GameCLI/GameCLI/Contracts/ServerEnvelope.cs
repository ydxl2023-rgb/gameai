using System.Text.Json;

namespace GameCLI.Contracts
{
    /// <summary>Versioned event transport shared with GameCLIServer; it does not authorize task execution.</summary>
    internal sealed record ServerEnvelope(int ProtocolVersion, string MessageId, string Type, DateTimeOffset SentAt, JsonElement Payload)
    {
        public static ServerEnvelope Create(string type, object payload)
        {
            return new ServerEnvelope(1, Guid.NewGuid().ToString(), type, DateTimeOffset.UtcNow, JsonSerializer.SerializeToElement(payload, WorkflowContract.Json));
        }

        /// <summary>Rejects incompatible or malformed envelopes before consuming their payload.</summary>
        public void Validate()
        {
            if (ProtocolVersion != 1 || !Guid.TryParse(MessageId, out _) || string.IsNullOrWhiteSpace(Type) || Payload.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException("服务器消息协议无效或版本不兼容。");
            }
        }
    }

    internal sealed record ServerCursor(string ServerId, long Sequence);
}
