using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Oathx.GameCLI.Protocol
{
    /// <summary>
    /// Shares length-prefixed UTF-8 JSON framing between the CLI and Unity Editor.
    /// </summary>
    public static class PipeProtocol
    {
        private const int MaximumFrameSize = 65536;

        // Shared framing: four-byte little-endian byte length, followed by UTF-8 JSON.
        /// <summary>Writes one four-byte little-endian length header followed by its UTF-8 JSON payload.</summary>
        /// <remarks>The caller retains ownership of the stream and must serialize concurrent writes.</remarks>
        /// <exception cref="InvalidDataException">The encoded payload is empty or exceeds 65,536 bytes.</exception>
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

        /// <summary>Reads one complete frame and strictly decodes its UTF-8 payload.</summary>
        /// <remarks>The caller retains ownership of the stream and supplies cancellation.</remarks>
        /// <exception cref="InvalidDataException">The advertised payload length is invalid.</exception>
        /// <exception cref="EndOfStreamException">The peer closes an incomplete frame.</exception>
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
