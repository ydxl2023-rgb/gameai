using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Reads source assets without loading their scripts or modifying the source project.</summary>
    public sealed class OfflinePrefabExporter
    {
        private readonly string input;
        private readonly string output;
        private readonly string project;
        private readonly string sourceKey;
        private readonly CancellationToken cancellation;
        private readonly Dictionary<string, string> assets = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, Resolved> cache = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> active = new(StringComparer.OrdinalIgnoreCase);
        private readonly JsonArray entries = new();
        private readonly HashSet<string> exported = new();
        private readonly JsonArray failures = new();
        private VisualEvidenceExporter visual = null!;
        private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };
        private static readonly Dictionary<string, string> ScriptTypes = LoadScriptTypes();

        private sealed record Resolved(Dictionary<string, UnityYaml.AssetObject> Objects, Dictionary<string, string> Aliases, string Root, string Revision);

        public OfflinePrefabExporter(string input, string output, string sourceKey, CancellationToken cancellation)
        {
            this.input = Path.GetFullPath(input);
            this.output = Path.GetFullPath(output);
            this.sourceKey = sourceKey;
            this.cancellation = cancellation;
            DirectoryInfo? cursor = new(Directory.Exists(this.input) ? this.input : Path.GetDirectoryName(this.input)!);
            while (cursor != null && !Directory.Exists(Path.Combine(cursor.FullName, "Assets")))
            {
                cursor = cursor.Parent;
            }
            project = cursor?.FullName ?? throw new ArgumentException("Input must belong to a Unity project with Assets.");
            if (IsWithin(this.output, project))
            {
                throw new ArgumentException("Export outside the source project to keep it read-only.");
            }
            if (Directory.Exists(this.output) && Directory.EnumerateFileSystemEntries(this.output).Any())
            {
                throw new ArgumentException("Output directory must be empty.");
            }
        }

        public JsonObject Run(int limit, int offset = 0)
        {
            foreach (string root in new[] { "Assets", "Packages", "LocalPackages" })
            {
                string directory = Path.Combine(project, root);
                if (!Directory.Exists(directory))
                {
                    continue;
                }
                foreach (string meta in Files(directory, "*.meta"))
                {
                    cancellation.ThrowIfCancellationRequested();
                    Match match = Regex.Match(File.ReadAllText(meta), @"^guid:\s*([a-fA-F0-9]{32})\s*$", RegexOptions.Multiline);
                    if (match.Success && !assets.TryAdd(match.Groups[1].Value, meta[..^5]) && assets[match.Groups[1].Value] != meta[..^5])
                    {
                        throw new InvalidDataException("Duplicate GUID in source project: " + match.Groups[1].Value);
                    }
                }
            }
            visual = new VisualEvidenceExporter(project, output, assets, cancellation, ScriptTypes.Keys.ToHashSet());
            Directory.CreateDirectory(Path.Combine(output, "visual"));
            string[] selected = Directory.Exists(input) ? Files(input, "*.prefab").Order(StringComparer.Ordinal).ToArray() : new[] { input };
            Directory.CreateDirectory(Path.Combine(output, "prefabs"));
            foreach (string file in selected.Skip(offset).Take(limit))
            {
                cancellation.ThrowIfCancellationRequested();
                try
                {
                    Match guid = Regex.Match(File.ReadAllText(file + ".meta"), @"^guid:\s*([a-fA-F0-9]{32})\s*$", RegexOptions.Multiline);
                    if (!guid.Success)
                    {
                        throw new InvalidDataException("Missing source GUID.");
                    }
                    Resolve(guid.Groups[1].Value);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    failures.Add(new JsonObject { ["assetPath"] = Relative(file), ["error"] = error.Message });
                }
                finally
                {
                    // Resolved object graphs are only needed while processing one root.
                    cache.Clear();
                }
            }
            JsonObject report = new()
            {
                ["success"] = failures.Count == 0,
                ["discovered"] = selected.Length,
                ["selected"] = Math.Min(Math.Max(0, selected.Length - offset), limit),
                ["exportedIncludingDependencies"] = entries.Count,
                ["failed"] = failures.Count,
                ["failures"] = failures
            };
            Write("report.json", report);
            Write("manifest.json", new JsonObject
            {
                ["schemaVersion"] = "ui-export/1", ["exporterVersion"] = "offline-layout/0.4",
                ["sourceKey"] = sourceKey, ["entries"] = entries,
                ["visualResources"] = visual.ExportResources(),
                ["failed"] = failures.Count,
                ["unityVersion"] = ReadUnityVersion(), ["reportFile"] = "report.json"
            });
            return report;
        }

        private Resolved Resolve(string guid)
        {
            cancellation.ThrowIfCancellationRequested();
            if (cache.TryGetValue(guid, out Resolved? cached))
            {
                return cached;
            }
            if (!active.Add(guid))
            {
                throw new InvalidDataException("Prefab dependency cycle: " + guid);
            }
            try
            {
                if (!assets.TryGetValue(guid, out string? path) || !File.Exists(path))
                {
                    throw new InvalidDataException("Missing prefab dependency: " + guid);
                }
                string text = File.ReadAllText(path);
                string revision = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
                Dictionary<string, UnityYaml.AssetObject> raw;
                try
                {
                    raw = UnityYaml.Parse(text);
                }
                catch (Exception error)
                {
                    throw new InvalidDataException(Relative(path) + ": " + error.Message, error);
                }
                Dictionary<string, UnityYaml.AssetObject> objects = new(StringComparer.Ordinal);
                Dictionary<string, string> aliases = raw.Keys.ToDictionary(key => key, key => key, StringComparer.Ordinal);
                JsonArray diagnostics = new();
                diagnostics.Add(new JsonObject { ["code"] = "offline-unity-validation-pending", ["message"] = "Layout snapshot requires reconstruction in the target Unity project before production reuse." });
                JsonObject resources = new();
                JsonArray instances = new();
                foreach (UnityYaml.AssetObject instance in raw.Values.Where(item => item.ClassId == 1001))
                {
                    string dependency = Str(instance.Data["m_SourcePrefab"]?["guid"]);
                    bool externalModel = assets.TryGetValue(dependency, out string? dependencyPath) && !dependencyPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase);
                    Resolved child = externalModel ? ModelPlaceholder() : Resolve(dependency);
                    string prefix = instance.Id + "/";
                    Dictionary<string, string> remap = child.Aliases.ToDictionary(pair => pair.Key, pair => prefix + pair.Value);
                    foreach (string id in child.Objects.Keys)
                    {
                        remap[id] = prefix + id;
                    }
                    foreach (UnityYaml.AssetObject stripped in raw.Values.Where(item => item.Stripped && Ref(item.Data["m_PrefabInstance"]) == instance.Id))
                    {
                        string target = Ref(stripped.Data["m_CorrespondingSourceObject"]);
                        if (externalModel)
                        {
                            remap[target] = prefix + (stripped.ClassId == 1 ? "model-go" : "model-transform");
                        }
                        if (remap.TryGetValue(target, out string? mapped))
                        {
                            aliases[stripped.Id] = mapped;
                        }
                    }
                    foreach (UnityYaml.AssetObject item in child.Objects.Values)
                    {
                        JsonObject data = (JsonObject)item.Data.DeepClone();
                        RewriteReferences(data, remap);
                        objects.Add(prefix + item.Id, item with { Id = prefix + item.Id, Data = data });
                    }
                    JsonObject modification = instance.Data["m_Modification"] as JsonObject ?? new();
                    objects[prefix + child.Root].Data["m_Father"] = modification["m_TransformParent"]?.DeepClone() ?? new JsonObject { ["fileID"] = "0" };
                    foreach (JsonNode? item in modification["m_Modifications"] as JsonArray ?? new())
                    {
                        string target = Ref(item?["target"]);
                        if (!remap.TryGetValue(target, out string? mapped) || !objects.TryGetValue(mapped, out UnityYaml.AssetObject? targetObject) || !SetProperty(targetObject.Data, Str(item?["propertyPath"]), item?["value"], item?["objectReference"], remap))
                        {
                            diagnostics.Add(new JsonObject { ["code"] = "unresolved-instance-override", ["instanceId"] = instance.Id, ["property"] = Str(item?["propertyPath"]) });
                        }
                    }
                    foreach (string field in new[] { "m_RemovedComponents", "m_RemovedGameObjects", "m_AddedGameObjects", "m_AddedComponents" })
                    {
                        if (modification[field] is JsonArray changes && changes.Count > 0)
                        {
                            diagnostics.Add(new JsonObject { ["code"] = "instance-structural-changes-require-review", ["instanceId"] = instance.Id, ["field"] = field, ["changes"] = changes.DeepClone() });
                        }
                    }
                    if (externalModel)
                    {
                        diagnostics.Add(new JsonObject { ["code"] = "model-prefab-placeholder", ["guid"] = dependency, ["assetPath"] = Relative(dependencyPath!), ["instanceId"] = instance.Id });
                    }
                    else
                    {
                        resources[dependency] = new JsonObject { ["kind"] = "prefab", ["id"] = dependency, ["version"] = child.Revision };
                        instances.Add(new JsonObject { ["instanceId"] = instance.Id, ["resourceRef"] = dependency, ["rootNodeId"] = prefix + child.Root });
                    }
                }
                foreach (UnityYaml.AssetObject item in raw.Values.Where(item => !item.Stripped && item.ClassId != 1001))
                {
                    objects.Add(item.Id, item with { Data = (JsonObject)item.Data.DeepClone() });
                }
                foreach (UnityYaml.AssetObject item in objects.Values)
                {
                    RewriteReferences(item.Data, aliases);
                }
                Dictionary<string, UnityYaml.AssetObject> transforms = objects.Where(pair => pair.Value.ClassId is 4 or 224).ToDictionary();
                string[] roots = transforms.Values.Where(item => Ref(item.Data["m_Father"]) == "0").Select(item => item.Id).ToArray();
                if (roots.Length != 1)
                {
                    throw new InvalidDataException("Expected one resolved prefab root; found " + roots.Length);
                }
                JsonArray nodes = BuildNodes(objects, transforms, diagnostics);
                JsonObject document = new()
                {
                    ["schemaVersion"] = "ui-template/1", ["resources"] = resources,
                    ["prefab"] = new JsonObject { ["name"] = Path.GetFileNameWithoutExtension(path), ["rootNodeId"] = roots[0], ["nodes"] = nodes, ["instances"] = instances }
                };
                string file = "prefabs/" + guid + ".json";
                Write(file, document);
                string visualFile = "visual/" + guid + ".json";
                Write(visualFile, visual.Capture(guid, objects));
                if (exported.Add(guid))
                {
                entries.Add(new JsonObject
                {
                    ["guid"] = guid, ["assetPath"] = Relative(path), ["sourceRevision"] = revision,
                    ["visualFile"] = visualFile, ["file"] = file, ["grade"] = "reference-only", ["diagnostics"] = diagnostics
                });
                }
                Resolved result = new(objects, aliases, roots[0], revision);
                cache.Add(guid, result);
                return result;
            }
            finally
            {
                active.Remove(guid);
            }
        }

        private JsonArray BuildNodes(Dictionary<string, UnityYaml.AssetObject> objects, Dictionary<string, UnityYaml.AssetObject> transforms, JsonArray diagnostics)
        {
            JsonArray nodes = new();
            Dictionary<string, string> gameObjects = transforms.Values.ToDictionary(item => Ref(item.Data["m_GameObject"]), item => item.Id);
            Dictionary<string, int> siblingCounters = new();
            foreach (UnityYaml.AssetObject item in transforms.Values.OrderBy(item => Order(item, transforms)).ThenBy(item => item.Id, StringComparer.Ordinal))
            {
                string parent = Ref(item.Data["m_Father"]);
                if (parent != "0" && !transforms.ContainsKey(parent))
                {
                    throw new InvalidDataException("Unresolved parent: " + parent);
                }
                string goId = Ref(item.Data["m_GameObject"]);
                if (!objects.TryGetValue(goId, out UnityYaml.AssetObject? go))
                {
                    throw new InvalidDataException("Missing GameObject: " + goId);
                }
                int order = siblingCounters.GetValueOrDefault(parent);
                siblingCounters[parent] = order + 1;
                JsonArray components = new();
                foreach (UnityYaml.AssetObject component in objects.Values.Where(value => value.ClassId != 4 && value.ClassId != 224 && Ref(value.Data["m_GameObject"]) == goId))
                {
                    string? type = component.ClassId switch
                    {
                        222 => "UnityEngine.CanvasRenderer", 223 => "UnityEngine.Canvas", 225 => "UnityEngine.CanvasGroup",
                        114 => ScriptTypes.GetValueOrDefault(Str(component.Data["m_Script"]?["guid"])), _ => null
                    };
                    // Explicit data-only adapter: preserve Text presentation, never custom behavior.
                    bool textAdapter = component.ClassId == 114 && Str(component.Data["m_Script"]?["guid"]) == "024d161225ddfa040a6eae59524a1995";
                    if (textAdapter)
                    {
                        type = "UnityEngine.UI.Text";
                        diagnostics.Add(new JsonObject { ["code"] = "sv-text-presentation-adapter", ["nodeId"] = item.Id, ["excluded"] = "Custom behavior and localization are not executed." });
                    }
                    if (type == null)
                    {
                        diagnostics.Add(new JsonObject { ["code"] = "unsupported-component", ["nodeId"] = item.Id, ["classId"] = component.ClassId, ["scriptGuid"] = Str(component.Data["m_Script"]?["guid"]) });
                        continue;
                    }
                    JsonObject properties = new();
                    if (textAdapter)
                    {
                        foreach (string field in new[] { "m_Enabled", "m_Color", "m_RaycastTarget", "m_Maskable", "m_FontData", "m_Text" })
                        {
                            if (component.Data[field] != null)
                            {
                                Flatten(component.Data[field], field, properties, objects, gameObjects, diagnostics, item.Id);
                            }
                        }
                    }
                    else
                    {
                        Flatten(component.Data, "", properties, objects, gameObjects, diagnostics, item.Id);
                    }
                    components.Add(new JsonObject { ["id"] = component.Id, ["type"] = type, ["properties"] = properties });
                }
                nodes.Add(new JsonObject
                {
                    ["id"] = item.Id, ["name"] = Str(go.Data["m_Name"]), ["kind"] = "Node",
                    ["parentId"] = parent == "0" ? null : parent, ["siblingIndex"] = order,
                    ["active"] = Str(go.Data["m_IsActive"]) != "0", ["components"] = components,
                    ["rect"] = item.ClassId == 224 ? new JsonObject
                    {
                        ["anchorMin"] = Vector(item.Data["m_AnchorMin"], "x", "y"), ["anchorMax"] = Vector(item.Data["m_AnchorMax"], "x", "y"),
                        ["pivot"] = Vector(item.Data["m_Pivot"], "x", "y"), ["anchoredPosition"] = Vector(item.Data["m_AnchoredPosition"], "x", "y"),
                        ["sizeDelta"] = Vector(item.Data["m_SizeDelta"], "x", "y")
                    } : null,
                    ["localPosition"] = Vector(item.Data["m_LocalPosition"], "x", "y", "z"),
                    ["localRotation"] = Vector(item.Data["m_LocalRotation"], "x", "y", "z", "w"),
                    ["localScale"] = Vector(item.Data["m_LocalScale"], "x", "y", "z")
                });
            }
            return nodes;
        }

        private void Flatten(JsonNode? value, string key, JsonObject outputProperties, Dictionary<string, UnityYaml.AssetObject> objects, Dictionary<string, string> gameObjects, JsonArray diagnostics, string nodeId)
        {
            if (key.Contains("m_PersistentCalls", StringComparison.Ordinal))
            {
                if (value?["m_Calls"] is JsonArray calls && calls.Count > 0)
                {
                    diagnostics.Add(new JsonObject { ["code"] = "business-callback-excluded", ["nodeId"] = nodeId });
                }
                return;
            }
            if (new[] { "m_Script", "m_GameObject", "m_CorrespondingSourceObject", "m_PrefabInstance", "m_PrefabAsset", "m_EditorClassIdentifier", "m_ObjectHideFlags" }.Contains(key))
            {
                return;
            }
            if (value is JsonObject map)
            {
                if (map.ContainsKey("fileID"))
                {
                    string reference = Ref(map);
                    string guid = Str(map["guid"]);
                    if (reference == "0")
                    {
                        outputProperties[key] = null;
                    }
                    else if (guid.Length == 0 && objects.TryGetValue(reference, out UnityYaml.AssetObject? target) && (target.ClassId is 1 or 4 or 224 || target.ClassId == 114 && ScriptTypes.ContainsKey(Str(target.Data["m_Script"]?["guid"]))))
                    {
                        string targetGo = target.ClassId == 1 ? target.Id : Ref(target.Data["m_GameObject"]);
                        if (gameObjects.TryGetValue(targetGo, out string? targetNode))
                        {
                            outputProperties[key] = new JsonObject { ["nodeId"] = targetNode };
                        }
                    }
                    else
                    {
                        diagnostics.Add(new JsonObject { ["code"] = "unresolved-resource", ["nodeId"] = nodeId, ["property"] = key, ["guid"] = guid, ["fileId"] = reference, ["assetPath"] = assets.TryGetValue(guid, out string? asset) ? Relative(asset) : null });
                    }
                    return;
                }
                foreach (KeyValuePair<string, JsonNode?> child in map)
                {
                    Flatten(child.Value, key.Length == 0 ? child.Key : key + "." + child.Key, outputProperties, objects, gameObjects, diagnostics, nodeId);
                }
            }
            else if (value is JsonArray array)
            {
                outputProperties[key + ".Array.size"] = array.Count;
                for (int index = 0; index < array.Count; index++)
                {
                    Flatten(array[index], key + ".Array.data[" + index + "]", outputProperties, objects, gameObjects, diagnostics, nodeId);
                }
            }
            else
            {
                outputProperties[key] = value?.DeepClone();
            }
        }

        private static int Order(UnityYaml.AssetObject item, Dictionary<string, UnityYaml.AssetObject> transforms)
        {
            if (transforms.TryGetValue(Ref(item.Data["m_Father"]), out UnityYaml.AssetObject? parent) && parent.Data["m_Children"] is JsonArray children)
            {
                for (int index = 0; index < children.Count; index++)
                {
                    if (Ref(children[index]) == item.Id)
                    {
                        return index;
                    }
                }
            }
            return int.TryParse(Str(item.Data["m_RootOrder"]), out int order) ? order : int.MaxValue;
        }

        private static Resolved ModelPlaceholder()
        {
            JsonObject go = new() { ["m_Name"] = "UnresolvedModel", ["m_IsActive"] = 1 };
            JsonObject transform = JsonNode.Parse("""
                {"m_GameObject":{"fileID":"model-go"},"m_Father":{"fileID":"0"},
                 "m_LocalPosition":{"x":0,"y":0,"z":0},"m_LocalRotation":{"x":0,"y":0,"z":0,"w":1},
                 "m_LocalScale":{"x":1,"y":1,"z":1}}
                """)!.AsObject();
            Dictionary<string, UnityYaml.AssetObject> objects = new()
            {
                ["model-go"] = new("model-go", 1, false, go),
                ["model-transform"] = new("model-transform", 4, false, transform)
            };
            return new Resolved(objects, new Dictionary<string, string>(), "model-transform", "unresolved");
        }

        private static bool SetProperty(JsonObject target, string path, JsonNode? value, JsonNode? reference, Dictionary<string, string> remap)
        {
            string[] segments = path.Replace(".Array.data[", ".").Replace("]", "").Split('.');
            JsonNode? cursor = target;
            for (int index = 0; index < segments.Length - 1; index++)
            {
                cursor = cursor is JsonArray array && int.TryParse(segments[index], out int item) && item < array.Count ? array[item] : (cursor as JsonObject)?[segments[index]];
                if (cursor == null)
                {
                    return false;
                }
            }
            string last = segments[^1];
            if (cursor is not JsonObject map || !map.ContainsKey(last))
            {
                return false;
            }
            JsonNode? replacement;
            if (map[last] is JsonObject old && old.ContainsKey("fileID"))
            {
                replacement = reference?.DeepClone();
                RewriteReferences(replacement, remap);
            }
            else if (map[last] is JsonValue scalar && scalar.TryGetValue<string>(out _))
            {
                replacement = JsonValue.Create(Str(value));
            }
            else if (double.TryParse(Str(value), NumberStyles.Float, CultureInfo.InvariantCulture, out double number) && double.IsFinite(number))
            {
                replacement = JsonValue.Create(number);
            }
            else
            {
                return false;
            }
            map[last] = replacement;
            return true;
        }

        private static void RewriteReferences(JsonNode? value, Dictionary<string, string> aliases)
        {
            if (value is JsonObject map)
            {
                if (map.ContainsKey("fileID") && !map.ContainsKey("guid") && aliases.TryGetValue(Ref(map), out string? replacement))
                {
                    map["fileID"] = replacement;
                }
                foreach (JsonNode? child in map.Select(pair => pair.Value).ToArray())
                {
                    RewriteReferences(child, aliases);
                }
            }
            else if (value is JsonArray array)
            {
                foreach (JsonNode? child in array)
                {
                    RewriteReferences(child, aliases);
                }
            }
        }

        private static JsonArray Vector(JsonNode? value, params string[] axes)
        {
            return new JsonArray(axes.Select(axis => JsonValue.Create(double.Parse(Str(value?[axis]), CultureInfo.InvariantCulture)) as JsonNode).ToArray());
        }

        private static string Ref(JsonNode? value) => Str(value?["fileID"]);

        private static string Str(JsonNode? value) => value?.ToString() ?? string.Empty;

        private string Relative(string path) => Path.GetRelativePath(project, path).Replace('\\', '/');

        private string? ReadUnityVersion()
        {
            string file = Path.Combine(project, "ProjectSettings", "ProjectVersion.txt");
            return File.Exists(file) ? File.ReadLines(file).FirstOrDefault() : null;
        }

        private void Write(string relative, JsonNode node)
        {
            File.WriteAllText(Path.Combine(output, relative), node.ToJsonString(Pretty));
        }

        private static bool IsWithin(string path, string root) => path.Equals(root, StringComparison.OrdinalIgnoreCase) || path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        private static IEnumerable<string> Files(string path, string pattern) => Directory.EnumerateFiles(path, pattern, new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint, IgnoreInaccessible = false });

        private static Dictionary<string, string> LoadScriptTypes()
        {
            using Stream stream = typeof(OfflinePrefabExporter).Assembly.GetManifestResourceStream("GameCLI.Contracts.UiScriptTypes.json") ?? throw new InvalidOperationException("Missing official component registry.");
            return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
        }
    }
}
