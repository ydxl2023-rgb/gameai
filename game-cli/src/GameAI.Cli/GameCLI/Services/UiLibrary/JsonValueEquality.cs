using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Compares JSON numbers exactly, independently of exponent spelling and without double rounding.</summary>
    public static class JsonValueEquality
    {
        public static bool Equal(JsonNode? left, JsonNode? right)
        {
            if (left is null || right is null)
            {
                return left is null && right is null;
            }
            if (left is JsonObject a && right is JsonObject b)
            {
                return a.Count == b.Count && a.All(pair => b.ContainsKey(pair.Key) && Equal(pair.Value, b[pair.Key]));
            }
            if (left is JsonArray x && right is JsonArray y)
            {
                return x.Count == y.Count && x.Select((item, index) => Equal(item, y[index])).All(equal => equal);
            }
            if (left.GetValueKind() == JsonValueKind.Number && right.GetValueKind() == JsonValueKind.Number)
            {
                return NumberKey(left.ToJsonString()) == NumberKey(right.ToJsonString());
            }
            return JsonNode.DeepEquals(left, right);
        }

        private static string NumberKey(string value)
        {
            string[] parts = value.ToLowerInvariant().Split('e');
            string mantissa = parts[0];
            int point = mantissa.IndexOf('.');
            BigInteger exponent = parts.Length == 2 ? BigInteger.Parse(parts[1], CultureInfo.InvariantCulture) : BigInteger.Zero;
            if (point >= 0)
            {
                exponent -= mantissa.Length - point - 1;
            }
            string sign = mantissa.StartsWith('-') ? "-" : "";
            string digits = mantissa.TrimStart('-').Replace(".", "").TrimStart('0');
            if (digits.Length == 0)
            {
                return "0";
            }
            int length = digits.Length;
            digits = digits.TrimEnd('0');
            exponent += length - digits.Length;
            return sign + digits + "e" + exponent.ToString(CultureInfo.InvariantCulture);
        }
    }
}
