using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    public static class UiManifestValidator
    {
        public static JsonObject Validate(JsonObject document, string project)
        {
            JsonArray results = new();
            JsonArray errors = new();
            HashSet<string> paths = new(StringComparer.OrdinalIgnoreCase);
            string root = Path.GetFullPath(project);
            if ((string?)document["schemaVersion"] != "ui-template/1" || document["visualTextures"] is not JsonArray textures)
            {
                throw new InvalidDataException("Expected ui-template/1 with visualTextures.");
            }
            foreach (JsonNode? item in textures)
            {
                string path = (string?)item?["path"] ?? "";
                JsonArray issues = new();
                JsonObject row = new() { ["path"] = path, ["issues"] = issues };
                results.Add(row);
                try
                {
                    if (!paths.Add(path))
                    {
                        throw new InvalidDataException("Duplicate resource path.");
                    }
                    if (!path.StartsWith("Assets/", StringComparison.Ordinal) || path.Contains('\\') || path.Split('/').Any(part => part is ".." or "." or ""))
                    {
                        throw new InvalidDataException("Resource must be a normalized Assets path.");
                    }
                    string full = Path.GetFullPath(Path.Combine(root, path));
                    if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("Resource escapes project.");
                    }
                    int width = (int?)item?["deliveryWidth"] ?? 0;
                    int height = (int?)item?["deliveryHeight"] ?? 0;
                    if (width <= 0 || height <= 0 || width > 8192 || height > 8192)
                    {
                        throw new InvalidDataException("Missing or invalid delivery dimensions.");
                    }
                    row["expectedWidth"] = width;
                    row["expectedHeight"] = height;
                    using FileStream stream = File.OpenRead(full);
                    byte[] header = new byte[24];
                    stream.ReadExactly(header);
                    if (!header.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) || !header.AsSpan(12, 4).SequenceEqual("IHDR"u8))
                    {
                        throw new InvalidDataException("Expected PNG with IHDR; unsupported format.");
                    }
                    int actualWidth = BinaryPrimitives.ReadInt32BigEndian(header.AsSpan(16, 4));
                    int actualHeight = BinaryPrimitives.ReadInt32BigEndian(header.AsSpan(20, 4));
                    row["actualWidth"] = actualWidth;
                    row["actualHeight"] = actualHeight;
                    if (width != actualWidth || height != actualHeight)
                    {
                        issues.Add("Texture dimensions differ from delivery contract.");
                    }
                    stream.Position = 0;
                    string hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
                    row["actualSha256"] = hash;
                    if (!string.Equals(hash, (string?)item?["deliverySha256"], StringComparison.OrdinalIgnoreCase))
                    {
                        issues.Add("Missing or mismatched deliverySha256.");
                    }
                    JsonNode? settings = item?["settings"];
                    double ppu = (double?)settings?["spritePixelsToUnits"] ?? 0;
                    if (!double.IsFinite(ppu) || ppu <= 0 || (int?)settings?["spriteMode"] != 1)
                    {
                        issues.Add("Invalid PPU or unsupported sprite mode.");
                    }
                    JsonNode? border = settings?["spriteBorder"];
                    double[] edges = new[] { "x", "y", "z", "w" }.Select(key => (double?)border?[key] ?? -1).ToArray();
                    if (edges.Any(value => !double.IsFinite(value) || value < 0) || edges[0] + edges[2] > width || edges[1] + edges[3] > height)
                    {
                        issues.Add("Invalid nine-slice border for delivery size.");
                    }
                }
                catch (Exception error) when (error is InvalidDataException or IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or FormatException or OverflowException)
                {
                    issues.Add(error.Message);
                }
                row["passed"] = issues.Count == 0;
            }
            // A list is not complete unless it covers every bound Sprite, including hidden UI.
            foreach (JsonNode? node in document["prefab"]?["nodes"]?.AsArray() ?? throw new InvalidDataException("Missing prefab nodes."))
            {
                foreach (JsonNode? component in node?["components"]?.AsArray() ?? new JsonArray())
                {
                    foreach (KeyValuePair<string, JsonNode?> property in component?["properties"]?.AsObject() ?? new JsonObject())
                    {
                        string? path = (string?)(property.Value as JsonObject)?["assetPath"];
                        if (path != null && (property.Key == "m_Sprite" || property.Key.Contains("Sprite", StringComparison.Ordinal)) && !paths.Contains(path))
                        {
                            errors.Add($"Unlisted Sprite: {node?["id"]}/{property.Key}: {path}");
                        }
                    }
                }
            }
            bool passed = errors.Count == 0 && results.All(row => (bool?)row?["passed"] == true);
            return new JsonObject { ["schemaVersion"] = "ui-manifest-validation/1", ["passed"] = passed, ["resources"] = results, ["errors"] = errors };
        }
    }
}
