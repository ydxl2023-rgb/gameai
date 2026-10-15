using System.Security.Cryptography;
using System.Text.Json.Nodes;
using GameCLI.Services.UiLibrary;

internal static class ManifestChecks
{
    internal static void Run(string project)
    {
        byte[] png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUeEAAAAASUVORK5CYII=");
        JsonObject features = PngFeatures.Analyze(png);
        if (features["pixelAnalysisStatus"]?.ToString() != "complete" || (int?)features["width"] != 1 || (long?)features["visiblePixels"] != 1)
        {
            throw new InvalidOperationException("Pixel extraction failed: " + features.ToJsonString());
        }
        byte[] unsupported = (byte[])png.Clone();
        unsupported[28] = 1;
        if (PngFeatures.Analyze(unsupported)["pixelAnalysisStatus"]?.ToString() != "unsupported")
        {
            throw new InvalidOperationException("Unsupported PNG must not be certified complete.");
        }
        File.WriteAllBytes(Path.Combine(project, "Assets", "Pixel.png"), png);
        JsonObject source = JsonNode.Parse("""
            {"schemaVersion":"ui-template/1","visualTextures":[{"path":"Assets/Pixel.png","deliveryWidth":1,"deliveryHeight":1,"settings":{"spriteMode":1,"spritePixelsToUnits":100,"spriteBorder":{"x":0,"y":0,"z":0,"w":0}}}],"prefab":{"nodes":[{"id":"n","components":[{"properties":{"m_Sprite":{"assetPath":"Assets/Pixel.png"},"m_Enabled":1}}]}]}}
            """)!.AsObject();
        source["visualTextures"]![0]!["deliverySha256"] = Convert.ToHexString(SHA256.HashData(png));
        Check(source, project, true);
        foreach (string failure in new[] { "dimensions", "hash", "border", "duplicate", "coverage", "missing" })
        {
            JsonObject test = (JsonObject)source.DeepClone();
            JsonNode texture = test["visualTextures"]![0]!;
            switch (failure)
            {
                case "dimensions":
                    texture["deliveryWidth"] = 92;
                    break;
                case "hash":
                    texture["deliverySha256"] = "bad";
                    break;
                case "border":
                    texture["settings"]!["spriteBorder"]!["x"] = 2;
                    break;
                case "duplicate":
                    test["visualTextures"]!.AsArray().Add(texture.DeepClone());
                    break;
                case "coverage":
                    test["visualTextures"]!.AsArray().Clear();
                    break;
                case "missing":
                    texture["path"] = "Assets/Missing.png";
                    break;
            }
            Check(test, project, false);
        }
        Console.WriteLine("Manifest validation: 7 assertions passed.");
    }

    private static void Check(JsonObject input, string project, bool expected)
    {
        JsonObject result = UiManifestValidator.Validate(input, project);
        if ((bool?)result["passed"] != expected)
        {
            throw new InvalidOperationException(result.ToJsonString());
        }
    }
}
