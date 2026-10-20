using System.Text.Json.Nodes;
using GameCLI.Services.UiLibrary;
using Newtonsoft.Json.Linq;
using Oathx.UnityCLI.Editor;

internal static class GuardChecks
{
    public static void Run()
    {
        const string source = """{"schemaVersion":"ui-template/1","prefab":{"nodes":[{"id":"3046798494246890801","name":"old","rect":{"anchoredPosition":[-8,1.4544e-05]},"components":[]}]}}""";
        string target = source.Replace("1.4544e-05", "0.000014544").Replace("\"old\"", "\"new\"");
        JsonArray changes = UiChangeGuard.Diff(UiChangeGuard.Normalize(JsonNode.Parse(source)!.AsObject()), UiChangeGuard.Normalize(JsonNode.Parse(target)!.AsObject()));
        Require(changes.Count == 1, "exponent spelling is not a layout change");
        JsonObject approval = new()
        {
            ["schemaVersion"] = "ui-change-approval/1",
            ["sourceSha256"] = AssemblyPlanCompiler.Hash(source),
            ["outputPrefab"] = "Assets/Tests/UIGuard.prefab",
            ["authorizationReference"] = "fixture: approved rename",
            ["changes"] = changes
        };
        // Reproduce the exact redundant entry present in A-0001035's approved attachment.
        changes.Add(JsonNode.Parse("""{"path":"/prefab/nodes/3046798494246890801/rect/anchoredPosition","beforeExists":true,"before":[-8,1.4544e-05],"afterExists":true,"after":[-8,0.000014544]}"""));
        JsonObject envelope = UiChangeGuard.Compile(source, target, approval);
        Require(UnityCliChangeGuard.Resolve(JObject.Parse(envelope.ToJsonString()), "Assets/Tests/UIGuard.prefab") != null, "both real guards accept the historical redundant entry without rewriting approval");
        Require((string?)envelope["baselineJson"] == source, "baseline raw bytes retained");
        Require((string?)envelope["approvalJson"] == approval.ToJsonString(), "approval retained");
        Require(!JsonValueEquality.Equal(JsonNode.Parse("9007199254740992"), JsonNode.Parse("9007199254740993")), "large integer precision retained");
        Require(JsonValueEquality.Equal(JsonNode.Parse("-0.00e12"), JsonNode.Parse("0")), "negative zero normalized");
        Require(!JsonValueEquality.Equal(JsonNode.Parse("1.00000000000000000000000000001"), JsonNode.Parse("1")), "small real differences retained");
        Require(JsonValueEquality.Equal(JsonNode.Parse("1e100000"), JsonNode.Parse("10e99999")), "huge exponents do not allocate expanded numbers");
        JsonObject invalid = (JsonObject)approval.DeepClone();
        invalid["changes"]![1]!["path"] = "/prefab/nodes/missing/rect/anchoredPosition";
        Reject(() => UiChangeGuard.Compile(source, target, invalid), "invented no-op rejected");
        invalid = (JsonObject)approval.DeepClone();
        invalid["changes"]!.AsArray().Add(invalid["changes"]![0]!.DeepClone());
        Reject(() => UiChangeGuard.Compile(source, target, invalid), "duplicate approval rejected");
        Reject(() => UiChangeGuard.Compile(source, target.Replace("0.000014544", "0.000014545"), approval), "real unauthorized coordinate change rejected");
        JsonObject tampered = (JsonObject)envelope.DeepClone();
        tampered["snapshotJson"] = target.Replace("0.000014544", "0.000014545");
        Reject(() => UnityCliChangeGuard.Resolve(JObject.Parse(tampered.ToJsonString()), "Assets/Tests/UIGuard.prefab"), "Unity rejects altered payload hashes");
        Console.WriteLine("Cross-runtime guard recovery and precision regression checks passed.");
        CheckResourceProjection();
    }

    private static void CheckResourceProjection()
    {
        const string source = """{"schemaVersion":"ui-template/1","prefab":{"nodes":[{"id":"root","components":[{"id":"image","properties":{"m_Sprite":{"assetPath":"Assets/Bound.png"}}}]}]},"visualTextures":[{"path":"Assets/Bound.png","deliveryWidth":10},{"path":"Assets/Historical.png","deliveryWidth":20}]}""";
        JsonObject target = JsonNode.Parse(source)!.AsObject();
        JsonObject manifest = (JsonObject)target.DeepClone();
        manifest["visualTextures"]!.AsArray().RemoveAt(1);
        JsonObject approval = new()
        {
            ["schemaVersion"] = "ui-change-approval/1",
            ["sourceSha256"] = AssemblyPlanCompiler.Hash(source),
            ["outputPrefab"] = "Assets/Tests/UIProjection.prefab",
            ["authorizationReference"] = "fixture: preserve all actual bindings",
            ["changes"] = new JsonArray()
        };
        JsonObject envelope = UiChangeGuard.Compile(source, source, approval);
        envelope["resourceManifestJson"] = manifest.ToJsonString();
        envelope["resourceManifestSha256"] = AssemblyPlanCompiler.Hash(manifest.ToJsonString());
        Require(UiResourceProjection.Apply(target, manifest)["visualTextures"]!.AsArray().Count == 1, "only explicitly projected unused metadata omitted");
        Require(UnityCliChangeGuard.Resolve(JObject.Parse(envelope.ToJsonString()), "Assets/Tests/UIProjection.prefab")["visualTextures"]!.Count() == 1, "Unity applies the same guarded projection");
        Require(target["visualTextures"]!.AsArray().Count == 2, "approved target remains intact");
        manifest["visualTextures"]!.AsArray().Clear();
        Reject(() => UiResourceProjection.Apply(target, manifest), "omitting bound texture rejected");
        envelope["resourceManifestJson"] = manifest.ToJsonString();
        envelope["resourceManifestSha256"] = AssemblyPlanCompiler.Hash(manifest.ToJsonString());
        Reject(() => UnityCliChangeGuard.Resolve(JObject.Parse(envelope.ToJsonString()), "Assets/Tests/UIProjection.prefab"), "Unity also rejects missing binding");
        manifest = (JsonObject)target.DeepClone();
        manifest["visualTextures"]![0]!["deliveryWidth"] = 999;
        Reject(() => UiResourceProjection.Apply(target, manifest), "changing retained texture metadata rejected");
        manifest = (JsonObject)target.DeepClone();
        manifest["prefab"]!["nodes"]![0]!["name"] = "changed";
        Reject(() => UiResourceProjection.Apply(target, manifest), "changing any target node rejected");
        Console.WriteLine("Guarded resource projection regression checks passed.");
    }

    private static void Require(bool value, string message)
    {
        if (!value)
        {
            throw new InvalidOperationException(message);
        }
    }

    private static void Reject(Action action, string message)
    {
        try
        {
            action();
        }
        catch (Exception error) when (error is InvalidDataException || error is InvalidOperationException)
        {
            return;
        }
        throw new InvalidOperationException(message);
    }
}
