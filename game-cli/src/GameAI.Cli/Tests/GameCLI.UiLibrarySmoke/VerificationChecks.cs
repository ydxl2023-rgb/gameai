using System.Security.Cryptography;
using System.Text.Json.Nodes;
using GameCLI.Services.UiLibrary;

internal static class VerificationChecks
{
    internal static void Run(string project)
    {
        const string source = """
            {"prefab":{"nodes":[{"id":"root","name":"UnrelatedWindow","parentId":null,"components":[]}]}}
            """;
        const string inventory = """
            {"sourceComponentInventory":[{"nodeId":"root","componentId":"anim","classId":95,"status":"captured","parameters":{}}]}
            """;
        JsonObject contract = VerificationContract.Build(source, inventory);
        JsonArray checks = contract["checks"]!.AsArray();
        Require(checks.Any(c => (string?)c?["kind"] == "animator.controller"), "raw inventory catches omitted Animator");
        Require(checks.Any(c => (string?)c?["kind"] == "unsupported"), "missing source curves block coverage");
        string text = contract.ToJsonString();
        string path = Path.Combine(project, "Assets", "VerificationFixture.prefab");
        File.WriteAllText(path, "fixture");
        JsonArray results = new(checks.Select(c => (JsonNode)new JsonObject { ["id"] = c!["id"]!.DeepClone(), ["status"] = "passed" }).ToArray());
        JsonObject evidence = new()
        {
            ["schemaVersion"] = "ui-verification-evidence/1", ["contractSha256"] = VerificationContract.Hash(text),
            ["prefabPath"] = "Assets/VerificationFixture.prefab", ["checks"] = results,
            ["dependencies"] = new JsonArray(new JsonObject
            {
                ["path"] = "Assets/VerificationFixture.prefab",
                ["sha256"] = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant()
            })
        };
        // Unsupported obligations must never be accepted merely because evidence claims success.
        Require(!Pass(text, evidence, project), "unsupported requirement cannot be forged as passed");
        checks.RemoveAt(checks.Count - 1);
        results.RemoveAt(results.Count - 1);
        text = contract.ToJsonString();
        evidence["contractSha256"] = VerificationContract.Hash(text);
        Require(Pass(text, evidence, project), "complete fresh evidence");
        results[1]!["status"] = "failed";
        Require(!Pass(text, evidence, project), "missing Animator blocks delivery");
        results[1]!["status"] = "passed";
        results.Add(results[0]!.DeepClone());
        Require(!Pass(text, evidence, project), "duplicate evidence rejected");
        results.RemoveAt(results.Count - 1);
        evidence["contractSha256"] = "stale";
        Require(!Pass(text, evidence, project), "stale contract rejected");
        evidence["contractSha256"] = VerificationContract.Hash(text);
        File.AppendAllText(path, "changed");
        Require(!Pass(text, evidence, project), "changed asset invalidates result");
        File.Delete(path);
        Console.WriteLine("8 verification contract checks passed.");
    }

    private static bool Pass(string contract, JsonObject evidence, string project)
    {
        return VerificationContract.Verify(contract, evidence, project)["passed"]!.GetValue<bool>();
    }

    private static void Require(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
