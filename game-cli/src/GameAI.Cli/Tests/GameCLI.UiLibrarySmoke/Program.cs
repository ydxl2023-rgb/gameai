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
            Require(before == Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(child))), "source bytes unchanged");
            File.WriteAllText(Path.Combine(assets, "Binary.prefab"), "not YAML");
            File.WriteAllText(Path.Combine(assets, "Binary.prefab.meta"), "guid: cccccccccccccccccccccccccccccccc");
            JsonObject partial = new OfflinePrefabExporter(assets, Path.Combine(workspace, "partial"), "fixture", default).Run(10);
            Require(partial["failed"]!.GetValue<int>() == 1 && !partial["success"]!.GetValue<bool>(), "binary asset reports failure without losing valid templates");
            File.WriteAllText(parent, ParentYaml.Replace(childGuid, parentGuid));
            JsonObject cycle = new OfflinePrefabExporter(parent, Path.Combine(workspace, "cycle"), "fixture", default).Run(10);
            Require(cycle["failed"]!.GetValue<int>() == 1, "cycles fail explicitly");
            Console.WriteLine("11 offline extraction assertions passed.");
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
