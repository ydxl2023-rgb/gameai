using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using YamlDotNet.RepresentationModel;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Parses Unity documents separately so local file IDs never pass through floating point.</summary>
    public static class UnityYaml
    {
        public static JsonNode? ParseMetadata(string text)
        {
            YamlStream yaml = new();
            yaml.Load(new StringReader(text));
            return Convert(yaml.Documents.Single().RootNode);
        }
        public sealed record AssetObject(string Id, int ClassId, bool Stripped, JsonObject Data);

        public static Dictionary<string, AssetObject> Parse(string text)
        {
            MatchCollection headers = Regex.Matches(text, @"^--- !u!(\d+) &(-?\d+)( stripped)?\s*\r?$", RegexOptions.Multiline);
            if (headers.Count == 0)
            {
                throw new InvalidDataException("Not a text-serialized Unity asset.");
            }
            Dictionary<string, AssetObject> result = new(StringComparer.Ordinal);
            for (int index = 0; index < headers.Count; index++)
            {
                Match header = headers[index];
                int end = index + 1 < headers.Count ? headers[index + 1].Index : text.Length;
                string body = text.Substring(header.Index + header.Length, end - header.Index - header.Length);
                YamlStream yaml = new();
                yaml.Load(new StringReader(body));
                YamlMappingNode mapping = (YamlMappingNode)yaml.Documents.Single().RootNode;
                JsonObject data = (JsonObject)Convert(mapping.Children.Single().Value)!;
                string id = header.Groups[2].Value;
                result.Add(id, new AssetObject(id, int.Parse(header.Groups[1].Value, CultureInfo.InvariantCulture), header.Groups[3].Success, data));
            }
            return result;
        }

        private static JsonNode? Convert(YamlNode node, string? key = null, int depth = 0)
        {
            if (depth > 128)
            {
                throw new InvalidDataException("YAML nesting limit exceeded.");
            }
            if (node is YamlMappingNode map)
            {
                JsonObject result = new();
                foreach (KeyValuePair<YamlNode, YamlNode> item in map.Children)
                {
                    string name = ((YamlScalarNode)item.Key).Value ?? string.Empty;
                    result.Add(name, Convert(item.Value, name, depth + 1));
                }
                return result;
            }
            if (node is YamlSequenceNode sequence)
            {
                return new JsonArray(sequence.Children.Select(child => Convert(child, null, depth + 1)).ToArray());
            }
            string value = ((YamlScalarNode)node).Value ?? string.Empty;
            // Unity's object IDs exceed the exact integer range of JavaScript numbers.
            if (key is "fileID" or "guid" || ((YamlScalarNode)node).Style is YamlDotNet.Core.ScalarStyle.DoubleQuoted or YamlDotNet.Core.ScalarStyle.SingleQuoted)
            {
                return JsonValue.Create(value);
            }
            if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long integer))
            {
                return JsonValue.Create(integer);
            }
            if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double number) && double.IsFinite(number))
            {
                return JsonValue.Create(number);
            }
            return JsonValue.Create(value);
        }
    }
}
