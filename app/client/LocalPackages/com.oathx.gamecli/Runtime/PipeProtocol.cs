using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Oathx.GameCLI.Protocol
{
    public static class PipeProtocol
    {
        private const int MaximumFrameSize = 65536;

        // Shared framing: four-byte little-endian byte length, followed by UTF-8 JSON.
        public static async Task WriteAsync(Stream stream, string json, CancellationToken token)
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            if (body.Length == 0 || body.Length > MaximumFrameSize)
            {
                throw new InvalidDataException("Invalid frame size.");
            }

            byte[] header = new byte[4];
            for (int i = 0; i < header.Length; i++)
            {
                header[i] = (byte)(body.Length >> (8 * i));
            }

            await stream.WriteAsync(header, 0, header.Length, token).ConfigureAwait(false);
            await stream.WriteAsync(body, 0, body.Length, token).ConfigureAwait(false);
            await stream.FlushAsync(token).ConfigureAwait(false);
        }

        public static async Task<string> ReadAsync(Stream stream, CancellationToken token)
        {
            byte[] header = new byte[4];
            await ReadExactlyAsync(stream, header, token).ConfigureAwait(false);
            int length = header[0] | (header[1] << 8) | (header[2] << 16) | (header[3] << 24);
            if (length <= 0 || length > MaximumFrameSize)
            {
                throw new InvalidDataException("Invalid frame size.");
            }

            byte[] body = new byte[length];
            await ReadExactlyAsync(stream, body, token).ConfigureAwait(false);
            return new UTF8Encoding(false, true).GetString(body);
        }

        private static async Task ReadExactlyAsync(Stream stream, byte[] buffer, CancellationToken token)
        {
            int offset = 0;
            while (offset < buffer.Length)
            {
                int count = await stream.ReadAsync(buffer, offset, buffer.Length - offset, token).ConfigureAwait(false);
                if (count == 0)
                {
                    throw new EndOfStreamException("The bridge closed an incomplete frame.");
                }

                offset += count;
            }
        }
    }
}
