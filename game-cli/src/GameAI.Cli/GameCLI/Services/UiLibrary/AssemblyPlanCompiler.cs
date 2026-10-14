using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Compiles bounded layout edits without modifying the source snapshot.</summary>
    public static class AssemblyPlanCompiler
    {
        public static string Hash(string text)
        {
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
        }

        public static JsonObject Compile(string snapshotText, JsonObject plan)
        {
            RequireKeys(plan, "schemaVersion", "sourceSha256", "outputPrefab", "operations");
            if ((string?)plan["schemaVersion"] != "ui-assembly-plan/1")
            {
                throw new InvalidDataException("Expected ui-assembly-plan/1.");
            }
            string sourceHash = Hash(snapshotText);
            if ((string?)plan["sourceSha256"] != sourceHash)
            {
                throw new InvalidDataException("Source snapshot hash mismatch.");
            }
            string output = (string?)plan["outputPrefab"] ?? "";
            if (!output.StartsWith("Assets/", StringComparison.Ordinal) || !output.EndsWith(".prefab", StringComparison.Ordinal)
                || output.Contains('\\') || output.Contains(':') || output.Split('/').Any(part => part is "" or "." or "..")
                || !Path.GetFileName(output).StartsWith("UI", StringComparison.Ordinal))
            {
                throw new InvalidDataException("Output must be Assets/.../UIName.prefab.");
            }
            JsonObject snapshot = JsonNode.Parse(snapshotText)?.AsObject() ?? throw new InvalidDataException("Missing snapshot.");
            if ((string?)snapshot["schemaVersion"] != "ui-template/1")
            {
                throw new InvalidDataException("This adapter requires ui-template/1; no implicit schema conversion.");
            }
            JsonArray nodes = snapshot["prefab"]?["nodes"]?.AsArray() ?? throw new InvalidDataException("Missing nodes.");
            Dictionary<string, JsonObject> byId = new(StringComparer.Ordinal);
            foreach (JsonNode? item in nodes)
            {
                JsonObject node = item?.AsObject() ?? throw new InvalidDataException("Invalid node.");
                string id = (string?)node["id"] ?? "";
                if (id.Length == 0 || !byId.TryAdd(id, node))
                {
                    throw new InvalidDataException("Duplicate or empty node ID.");
                }
            }
            JsonArray operations = plan["operations"]?.AsArray() ?? throw new InvalidDataException("Missing operations.");
            if (operations.Count > 2048)
            {
                throw new InvalidDataException("Too many operations.");
            }
            HashSet<string> operationIds = new(StringComparer.Ordinal);
            foreach (JsonNode? item in operations)
            {
                JsonObject operation = item?.AsObject() ?? throw new InvalidDataException("Invalid operation.");
                RequireKeys(operation, "id", "op", "nodeId", "field", "value");
                string id = (string?)operation["id"] ?? "";
                if (id.Length == 0 || !operationIds.Add(id))
                {
                    throw new InvalidDataException("Duplicate or empty operation ID.");
                }
                if (!byId.TryGetValue((string?)operation["nodeId"] ?? "", out JsonObject? node))
                {
                    throw new InvalidDataException("Unknown target node: " + id);
                }
                if ((string?)operation["op"] != "setRect")
                {
                    throw new InvalidDataException("Unsupported operation; first adapter supports setRect only: " + id);
                }
                string field = (string?)operation["field"] ?? "";
                if (!new[] { "anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta" }.Contains(field))
                {
                    throw new InvalidDataException("Unsupported RectTransform field: " + field);
                }
                JsonArray value = operation["value"]?.AsArray() ?? throw new InvalidDataException("Expected vector2.");
                if (value.Count != 2 || value.Any(part => !IsFiniteNumber(part)))
                {
                    throw new InvalidDataException("Expected finite vector2.");
                }
                JsonObject rect = node["rect"]?.AsObject() ?? throw new InvalidDataException("Target has no RectTransform.");
                if (!rect.ContainsKey(field))
                {
                    throw new InvalidDataException("Source rect field missing: " + field);
                }
                rect[field] = value.DeepClone();
            }
            // Hash the exact embedded string so Unity and .NET do not need matching JSON serializers.
            string resolved = snapshot.ToJsonString();
            return new JsonObject
            {
                ["schemaVersion"] = "ui-assembly/1",
                ["adapterVersion"] = "layout-edits/1",
                ["sourceSha256"] = sourceHash,
                ["planJson"] = plan.ToJsonString(),
                ["planSha256"] = Hash(plan.ToJsonString()),
                ["outputPrefab"] = output,
                ["snapshotJson"] = resolved,
                ["snapshotSha256"] = Hash(resolved)
            };
        }

        private static bool IsFiniteNumber(JsonNode? value)
        {
            return value is JsonValue scalar && scalar.GetValueKind() == JsonValueKind.Number
                && double.TryParse(scalar.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double number)
                && double.IsFinite(number) && Math.Abs(number) <= float.MaxValue;
        }

        private static void RequireKeys(JsonObject value, params string[] keys)
        {
            if (value.Count != keys.Length || keys.Any(key => !value.ContainsKey(key)))
            {
                throw new InvalidDataException("Unexpected or missing fields; expected: " + string.Join(", ", keys));
            }
        }
    }
}
