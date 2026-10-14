using System.Security.Cryptography;
using System.Text.Json.Nodes;
using GameCLI.Services.UiLibrary;

internal static class Program
{
    private static int Main()
    {
        string workspace = Path.Combine(Path.GetTempPath(), "gameai-offline-test-" + Guid.NewGuid().ToString("N"));
        string project = Path.Combine(workspace, "project");
        string assets = Path.Combine(project, "Assets");
        Directory.CreateDirectory(assets);
        try
        {
            ManifestChecks.Run(project);
            const string childGuid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            const string parentGuid = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
            string child = Path.Combine(assets, "Child.prefab");
            string parent = Path.Combine(assets, "Parent.prefab");
            File.WriteAllText(child, ChildYaml);
            File.WriteAllText(child + ".meta", "guid: " + childGuid);
            File.WriteAllText(parent, ParentYaml);
            File.WriteAllText(parent + ".meta", "guid: " + parentGuid);
            string before = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(child)));
            var parsed = UnityYaml.Parse(ChildYaml);
            Require(parsed.ContainsKey("9007199254740999"), "64-bit file ID preserved");
            Require(parsed["10"].Data["m_GameObject"]!["fileID"]!.GetValue<string>() == "9007199254740999", "reference ID remains string");
            string output = Path.Combine(workspace, "export");
            JsonObject report = new OfflinePrefabExporter(parent, output, "fixture", default).Run(10);
            Require(report["failed"]!.GetValue<int>() == 0, "nested export succeeds");
            Require(report["exportedIncludingDependencies"]!.GetValue<int>() == 2, "dependency closure exported");
            JsonObject document = JsonNode.Parse(File.ReadAllText(Path.Combine(output, "prefabs", parentGuid + ".json")))!.AsObject();
            JsonArray nodes = document["prefab"]!["nodes"]!.AsArray();
            Require(nodes.Count == 1, "variant resolves one root");
            Require(nodes[0]!["name"]!.GetValue<string>() == "Overridden", "name override applied");
            Require(nodes[0]!["rect"]!["sizeDelta"]![0]!.GetValue<double>() == 321, "numeric override applied");
            JsonObject original = JsonNode.Parse(File.ReadAllText(Path.Combine(output, "prefabs", childGuid + ".json")))!.AsObject();
            Require(original["prefab"]!["nodes"]![0]!["rect"]!["sizeDelta"]![0]!.GetValue<double>() == -17, "source template not mutated by instance");
            string sourceText = original.ToJsonString();
            string nodeId = original["prefab"]!["nodes"]![0]!["id"]!.GetValue<string>();
            JsonObject plan = new()
            {
                ["schemaVersion"] = "ui-assembly-plan/1",
                ["sourceSha256"] = AssemblyPlanCompiler.Hash(sourceText),
                ["outputPrefab"] = "Assets/Tests/UIAssembly.prefab",
                ["operations"] = new JsonArray(new JsonObject
                {
                    ["id"] = "resize",
                    ["op"] = "setRect",
                    ["nodeId"] = nodeId,
                    ["field"] = "sizeDelta",
                    ["value"] = new JsonArray(512, 128)
                })
            };
            JsonObject assembly = AssemblyPlanCompiler.Compile(sourceText, plan);
            JsonNode resolved = JsonNode.Parse((string)assembly["snapshotJson"]!)!;
            Require(resolved["prefab"]!["nodes"]![0]!["rect"]!["sizeDelta"]![0]!.GetValue<int>() == 512, "assembly applies layout edit");
            Require(original.ToJsonString() == sourceText, "assembly does not mutate source");
            Require(assembly.ToJsonString() == AssemblyPlanCompiler.Compile(sourceText, plan).ToJsonString(), "assembly is deterministic");
            RequireRejected(() => AssemblyPlanCompiler.Compile(sourceText + " ", plan), "changed source rejected");
            JsonObject badPlan = (JsonObject)plan.DeepClone();
            badPlan["operations"]![0]!["nodeId"] = "missing";
            RequireRejected(() => AssemblyPlanCompiler.Compile(sourceText, badPlan), "missing node rejected");
            badPlan = (JsonObject)plan.DeepClone();
            badPlan["outputPrefab"] = "Assets/../UIEscape.prefab";
            RequireRejected(() => AssemblyPlanCompiler.Compile(sourceText, badPlan), "output traversal rejected");
            badPlan = (JsonObject)plan.DeepClone();
            badPlan["operations"]![0]!["op"] = "executeScript";
            RequireRejected(() => AssemblyPlanCompiler.Compile(sourceText, badPlan), "unsupported operation rejected");
            Require(before == Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(child))), "source bytes unchanged");
            File.WriteAllText(Path.Combine(assets, "Binary.prefab"), "not YAML");
            File.WriteAllText(Path.Combine(assets, "Binary.prefab.meta"), "guid: cccccccccccccccccccccccccccccccc");
            JsonObject partial = new OfflinePrefabExporter(assets, Path.Combine(workspace, "partial"), "fixture", default).Run(10);
            Require(partial["failed"]!.GetValue<int>() == 1 && !partial["success"]!.GetValue<bool>(), "binary asset reports failure without losing valid templates");
            File.WriteAllText(parent, ParentYaml.Replace(childGuid, parentGuid));
            JsonObject cycle = new OfflinePrefabExporter(parent, Path.Combine(workspace, "cycle"), "fixture", default).Run(10);
            Require(cycle["failed"]!.GetValue<int>() == 1, "cycles fail explicitly");
            JsonObject candidate = (JsonObject)original.DeepClone();
            candidate["prefab"]!["nodes"]![0]!["name"] = "Changed";
            JsonArray exactChanges = UiChangeGuard.Diff(UiChangeGuard.Normalize(original), UiChangeGuard.Normalize(candidate));
            JsonObject approval = new()
            {
                ["schemaVersion"] = "ui-change-approval/1",
                ["sourceSha256"] = AssemblyPlanCompiler.Hash(sourceText),
                ["authorizationReference"] = "test-fixture: explicitly rename one node",
                ["outputPrefab"] = "Assets/Tests/UIApproved.prefab",
                ["changes"] = exactChanges.DeepClone()
            };
            Require((string?)UiChangeGuard.Compile(sourceText, candidate.ToJsonString(), approval)["schemaVersion"] == "ui-assembly/2", "authorized rename accepted");
            candidate["prefab"]!["nodes"]![0]!["active"] = false;
            RequireRejected(() => UiChangeGuard.Compile(sourceText, candidate.ToJsonString(), approval), "unapproved hidden state rejected");
            RequireRejected(() => UiChangeGuard.Compile(sourceText + " ", original.ToJsonString(), approval), "stale baseline rejected");
            JsonObject added = (JsonObject)original.DeepClone();
            JsonObject addedNode = (JsonObject)added["prefab"]!["nodes"]![0]!.DeepClone();
            addedNode["id"] = "new-control";
            added["prefab"]!["nodes"]!.AsArray().Add(addedNode);
            approval["changes"] = UiChangeGuard.Diff(UiChangeGuard.Normalize(original), UiChangeGuard.Normalize(added));
            Require(UiChangeGuard.Compile(sourceText, added.ToJsonString(), approval) != null, "explicit addition accepted by scope guard");
            added["prefab"]!["nodes"]!.AsArray().RemoveAt(0);
            RequireRejected(() => UiChangeGuard.Compile(sourceText, added.ToJsonString(), approval), "same count ID replacement rejected");
            JsonObject removed = (JsonObject)original.DeepClone();
            removed["prefab"]!["nodes"]!.AsArray().RemoveAt(0);
            approval["changes"] = UiChangeGuard.Diff(UiChangeGuard.Normalize(original), UiChangeGuard.Normalize(removed));
            Require(UiChangeGuard.Compile(sourceText, removed.ToJsonString(), approval) != null, "explicit deletion accepted; Unity validates remaining hierarchy separately");
            Console.WriteLine("18 extraction/assembly and 6 change guard assertions passed.");
            return 0;
        }
        finally
        {
            // Only this invocation's freshly allocated fixture directory is removed.
            if (Path.GetDirectoryName(workspace) == Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar) && Path.GetFileName(workspace).StartsWith("gameai-offline-test-", StringComparison.Ordinal))
            {
                Directory.Delete(workspace, true);
            }
        }
    }

    private static void RequireRejected(Action action, string message)
    {
        try
        {
            action();
        }
        catch (InvalidDataException)
        {
            return;
        }
        throw new InvalidOperationException(message);
    }

    private static void Require(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }

    private const string ChildYaml = """
        %YAML 1.1
        %TAG !u! tag:unity3d.com,2011:
        --- !u!1 &9007199254740999
        GameObject:
          m_Name: Original
          m_IsActive: 1
        --- !u!224 &10
        RectTransform:
          m_GameObject: {fileID: 9007199254740999}
          m_Father: {fileID: 0}
          m_Children: []
          m_AnchorMin: {x: 0, y: 0}
          m_AnchorMax: {x: 1, y: 1}
          m_Pivot: {x: 0.5, y: 0.5}
          m_AnchoredPosition: {x: 0, y: 0}
          m_SizeDelta: {x: -17, y: 0}
          m_LocalPosition: {x: 0, y: 0, z: 0}
          m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
          m_LocalScale: {x: 1, y: 1, z: 1}
        """;

    private const string ParentYaml = """
        %YAML 1.1
        %TAG !u! tag:unity3d.com,2011:
        --- !u!1001 &20
        PrefabInstance:
          m_SourcePrefab: {fileID: 100100000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
          m_Modification:
            m_TransformParent: {fileID: 0}
            m_Modifications:
            - target: {fileID: 10, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
              propertyPath: m_SizeDelta.x
              value: 321
              objectReference: {fileID: 0}
            - target: {fileID: 9007199254740999, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
              propertyPath: m_Name
              value: Overridden
              objectReference: {fileID: 0}
        """;
}
