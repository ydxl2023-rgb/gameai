using System.Buffers.Binary;
using System.IO.Compression;
using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Deterministic pixel evidence, not inferred art style. Unsupported encodings fail explicitly.</summary>
    public static class PngFeatures
    {
        public static JsonObject Analyze(byte[] bytes)
        {
            JsonObject result = new()
            {
                ["pixelAnalysisStatus"] = "unsupported",
                ["styleAnalysisStatus"] = "not-analyzed"
            };
            try
            {
                int width = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
                int height = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
                int type = bytes[25];
                int channels = type switch
                {
                    0 => 1,
                    2 => 3,
                    3 => 1,
                    4 => 2,
                    6 => 4,
                    _ => 0
                };
                result["bitDepth"] = bytes[24];
                result["colorType"] = type;
                if (bytes[24] != 8 || bytes[28] != 0 || channels == 0 || width <= 0 || height <= 0 || (long)width * height > 33554432)
                {
                    result["reason"] = "Requires non-interlaced 8-bit PNG within 32 megapixels.";
                    return result;
                }
                using MemoryStream compressed = new();
                byte[] palette = Array.Empty<byte>();
                byte[] transparency = Array.Empty<byte>();
                int offset = 8;
                while (offset + 12 <= bytes.Length)
                {
                    int length = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(offset, 4));
                    if (length < 0 || (long)offset + length + 12 > bytes.Length)
                    {
                        throw new InvalidDataException("Truncated PNG chunk.");
                    }
                    string kind = System.Text.Encoding.ASCII.GetString(bytes, offset + 4, 4);
                    if (kind == "IDAT")
                    {
                        compressed.Write(bytes, offset + 8, length);
                    }
                    if (kind == "PLTE")
                    {
                        palette = bytes.AsSpan(offset + 8, length).ToArray();
                    }
                    if (kind == "tRNS")
                    {
                        transparency = bytes.AsSpan(offset + 8, length).ToArray();
                    }
                    offset += length + 12;
                }
                compressed.Position = 0;
                using ZLibStream stream = new(compressed, CompressionMode.Decompress);
                int stride = checked(width * channels);
                byte[] previous = new byte[stride];
                byte[] row = new byte[stride];
                long visible = 0;
                long translucent = 0;
                long alphaSum = 0;
                int minX = width;
                int minY = height;
                int maxX = -1;
                int maxY = -1;
                Dictionary<int, long> colors = new();
                for (int y = 0; y < height; y++)
                {
                    int filter = stream.ReadByte();
                    if (filter < 0 || filter > 4)
                    {
                        throw new InvalidDataException("Invalid PNG row filter.");
                    }
                    stream.ReadExactly(row);
                    for (int x = 0; x < stride; x++)
                    {
                        int a = x >= channels ? row[x - channels] : 0;
                        int b = previous[x];
                        int c = x >= channels ? previous[x - channels] : 0;
                        int prediction = filter switch
                        {
                            1 => a,
                            2 => b,
                            3 => (a + b) / 2,
                            4 => Paeth(a, b, c),
                            _ => 0
                        };
                        row[x] = unchecked((byte)(row[x] + prediction));
                    }
                    for (int x = 0; x < width; x++)
                    {
                        int i = x * channels;
                        int r = row[i];
                        int g = type is 2 or 6 ? row[i + 1] : r;
                        int b = type is 2 or 6 ? row[i + 2] : r;
                        int alpha = type == 6 ? row[i + 3] : type == 4 ? row[i + 1] : 255;
                        if (type == 3)
                        {
                            int entry = r;
                            r = palette[entry * 3];
                            g = palette[entry * 3 + 1];
                            b = palette[entry * 3 + 2];
                            alpha = entry < transparency.Length ? transparency[entry] : 255;
                        }
                        if (type == 0 && transparency.Length == 2 && r == BinaryPrimitives.ReadUInt16BigEndian(transparency))
                        {
                            alpha = 0;
                        }
                        if (type == 2 && transparency.Length == 6 && r == BinaryPrimitives.ReadUInt16BigEndian(transparency) && g == BinaryPrimitives.ReadUInt16BigEndian(transparency.AsSpan(2)) && b == BinaryPrimitives.ReadUInt16BigEndian(transparency.AsSpan(4)))
                        {
                            alpha = 0;
                        }
                        alphaSum += alpha;
                        if (alpha == 0)
                        {
                            continue;
                        }
                        visible++;
                        if (alpha < 255)
                        {
                            translucent++;
                        }
                        minX = Math.Min(minX, x);
                        minY = Math.Min(minY, y);
                        maxX = Math.Max(maxX, x);
                        maxY = Math.Max(maxY, y);
                        int color = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
                        colors[color] = colors.GetValueOrDefault(color) + 1;
                    }
                    (previous, row) = (row, previous);
                }
                result["pixelAnalysisStatus"] = "complete";
                result["width"] = width;
                result["height"] = height;
                result["visiblePixels"] = visible;
                result["transparentPixels"] = (long)width * height - visible;
                result["translucentPixels"] = translucent;
                result["meanAlpha"] = alphaSum / (255.0 * width * height);
                result["visibleBounds"] = visible == 0 ? null : new JsonObject { ["x"] = minX, ["y"] = minY, ["width"] = maxX - minX + 1, ["height"] = maxY - minY + 1, ["origin"] = "top-left" };
                result["paletteQuantization"] = "4-bit RGB, visible pixels only";
                result["dominantColors"] = new JsonArray(colors.OrderByDescending(pair => pair.Value).ThenBy(pair => pair.Key).Take(8).Select(pair => (JsonNode)new JsonObject { ["rgbBin"] = pair.Key.ToString("x3"), ["pixels"] = pair.Value }).ToArray());
            }
            catch (Exception error) when (error is InvalidDataException or EndOfStreamException or ArgumentException or IndexOutOfRangeException or OverflowException)
            {
                result["pixelAnalysisStatus"] = "failed";
                result["reason"] = error.Message;
            }
            return result;
        }

        private static int Paeth(int a, int b, int c)
        {
            int p = a + b - c;
            int pa = Math.Abs(p - a);
            int pb = Math.Abs(p - b);
            int pc = Math.Abs(p - c);
            return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
    }
}
