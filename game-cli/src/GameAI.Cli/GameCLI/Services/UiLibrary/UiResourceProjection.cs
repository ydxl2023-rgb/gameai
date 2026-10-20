using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Projects an explicit resource manifest without changing any approved node or bound resource.</summary>
    public static class UiResourceProjection
    {
        public static JsonObject Apply(JsonObject target, JsonObject manifest)
        {
            JsonObject approvedPrefab = UiChangeGuard.Normalize(target)["prefab"]!.AsObject();
            JsonObject manifestPrefab = UiChangeGuard.Normalize(manifest)["prefab"]!.AsObject();
            // Export provenance may still list already-expanded instances. Restore
            // consumes the complete flat node table, never this provenance array.
            approvedPrefab.Remove("instances");
            manifestPrefab.Remove("instances");
            if (!JsonValueEquality.Equal(approvedPrefab, manifestPrefab))
            {
                throw new InvalidDataException("Resource manifest changes the approved prefab.");
            }
            Dictionary<string, JsonNode> original = new(StringComparer.Ordinal);
            foreach (JsonNode? item in target["visualTextures"]!.AsArray())
            {
                original.Add((string)item!["path"]!, item);
            }
            HashSet<string> selected = new(StringComparer.Ordinal);
            JsonArray textures = new();
            foreach (JsonNode? item in manifest["visualTextures"]!.AsArray())
            {
                string path = (string)item!["path"]!;
                if (!selected.Add(path) || !original.TryGetValue(path, out JsonNode? approved) || !JsonValueEquality.Equal(approved, item))
                {
                    throw new InvalidDataException("Resource manifest adds or changes an approved texture.");
                }
                textures.Add(approved.DeepClone());
            }
            foreach (string path in AssetPaths(target["prefab"]))
            {
                if (path.EndsWith(".png", StringComparison.OrdinalIgnoreCase) && !selected.Contains(path))
                {
                    throw new InvalidDataException("Resource manifest omits a bound texture: " + path);
                }
            }
            JsonObject result = (JsonObject)target.DeepClone();
            result["visualTextures"] = textures;
            return result;
        }

        private static IEnumerable<string> AssetPaths(JsonNode? value)
        {
            if (value is JsonObject obj)
            {
                foreach (var pair in obj)
                {
                    if (pair.Key == "assetPath" && pair.Value is JsonValue path && path.TryGetValue(out string? text))
                    {
                        yield return text;
                    }
                    foreach (string nested in AssetPaths(pair.Value))
                    {
                        yield return nested;
                    }
                }
            }
            else if (value is JsonArray array)
            {
                foreach (JsonNode? item in array)
                {
                    foreach (string nested in AssetPaths(item))
                    {
                        yield return nested;
                    }
                }
            }
        }
    }
}
