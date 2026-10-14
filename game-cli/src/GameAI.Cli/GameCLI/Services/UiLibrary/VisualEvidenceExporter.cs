using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Collects versioned source appearance evidence without executing source shaders or scripts.</summary>
    public sealed class VisualEvidenceExporter
    {
        private readonly string project;
        private readonly string output;
        private readonly Dictionary<string, string> paths;
        private readonly CancellationToken cancellation;
        private readonly HashSet<string> scriptTypes;
        private readonly JsonObject resources = new();

        public VisualEvidenceExporter(string project, string output, Dictionary<string, string> paths, CancellationToken cancellation, HashSet<string> scriptTypes)
        {
            this.scriptTypes = new HashSet<string>(scriptTypes) { "024d161225ddfa040a6eae59524a1995" };
            this.project = project;
            this.output = output;
            this.paths = paths;
            this.cancellation = cancellation;
        }

        public JsonArray ExportResources()
        {
            return new JsonArray(resources.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => pair.Value!.DeepClone()).ToArray());
        }

        public JsonObject Capture(string prefabGuid, Dictionary<string, UnityYaml.AssetObject> objects)
        {
            JsonArray bindings = new();
            JsonArray components = new();
            Dictionary<string, string> nodes = objects.Values.Where(item => item.ClassId is 4 or 224)
                .ToDictionary(item => item.Data["m_GameObject"]?["fileID"]?.ToString() ?? "", item => item.Id);
            foreach (UnityYaml.AssetObject item in objects.Values)
            {
                cancellation.ThrowIfCancellationRequested();
                string go = item.Data["m_GameObject"]?["fileID"]?.ToString() ?? "";
                if (!nodes.TryGetValue(go, out string? node))
                {
                    continue;
                }
                // Custom MonoBehaviours are excluded. Only standard visual fields are observed on UGUI scripts.
                if (item.ClassId == 114 && scriptTypes.Contains(item.Data["m_Script"]?["guid"]?.ToString() ?? ""))
                {
                    foreach (KeyValuePair<string, JsonNode?> property in item.Data.Where(pair => new[] { "m_Sprite", "m_Texture", "m_Material", "m_fontAsset", "m_sharedMaterial", "m_FontData", "m_SpriteState" }.Contains(pair.Key)))
                    {
                        CaptureReferences(property.Value, property.Key, node, item.Id, bindings);
                    }
                }
                else if (new[] { 95, 111, 198, 199, 23, 212, 222, 223, 225 }.Contains(item.ClassId))
                {
                    JsonObject safe = Sanitize(item.Data).AsObject();
                    CaptureReferences(safe, "", node, item.Id, bindings);
                    if (new[] { 95, 111, 198, 199, 23, 212 }.Contains(item.ClassId))
                    {
                        string id = prefabGuid + ":" + item.Id;
                        JsonObject evidence = new()
                        {
                            ["id"] = id,
                            ["kind"] = item.ClassId is 198 or 199 ? "effect" : item.ClassId is 95 or 111 ? "animation-binding" : "renderer",
                            ["status"] = "serialized-evidence",
                            ["classId"] = item.ClassId,
                            ["parameters"] = safe,
                            ["dependencies"] = References(safe),
                            ["limitations"] = new JsonArray("Requires target-Unity mapping; source business code, animation events and script callbacks are excluded.")
                        };
                        resources[id] = evidence;
                        components.Add(new JsonObject { ["nodeId"] = node, ["componentId"] = item.Id, ["resourceId"] = id });
                    }
                }
            }
            return new JsonObject
            {
                ["schemaVersion"] = "ui-visual/1",
                ["bindings"] = bindings,
                ["components"] = components,
                ["purpose"] = "Source appearance evidence for post-whitebox generation, not a ready-to-run target asset package."
            };
        }

        private void CaptureReferences(JsonNode? value, string property, string node, string component, JsonArray bindings)
        {
            if (value is JsonObject map)
            {
                if (map.ContainsKey("fileID"))
                {
                    string fileId = map["fileID"]!.ToString();
                    if (fileId == "0")
                    {
                        return;
                    }
                    string guid = map["guid"]?.ToString() ?? "";
                    if (guid.Length == 32)
                    {
                        Collect(guid);
                    }
                    bindings.Add(new JsonObject
                    {
                        ["nodeId"] = node, ["componentId"] = component, ["property"] = property,
                        ["resourceId"] = guid.Length == 32 ? guid : null,
                        ["fileId"] = fileId,
                        ["status"] = guid.Length == 32 ? resources[guid]?["status"]?.ToString() : "local-or-builtin-reference"
                    });
                    return;
                }
                foreach (KeyValuePair<string, JsonNode?> child in map)
                {
                    CaptureReferences(child.Value, property.Length == 0 ? child.Key : property + "." + child.Key, node, component, bindings);
                }
            }
            else if (value is JsonArray array)
            {
                for (int index = 0; index < array.Count; index++)
                {
                    CaptureReferences(array[index], property + "[" + index + "]", node, component, bindings);
                }
            }
        }

        private void Collect(string guid)
        {
            cancellation.ThrowIfCancellationRequested();
            if (resources.ContainsKey(guid))
            {
                return;
            }
            JsonObject descriptor = new()
            {
                ["id"] = guid, ["kind"] = "unknown", ["status"] = "unresolved", ["dependencies"] = new JsonArray()
            };
            // Register before traversal: controller and material graphs may contain cycles.
            resources[guid] = descriptor;
            if (!paths.TryGetValue(guid, out string? file) || !File.Exists(file))
            {
                descriptor["limitations"] = new JsonArray("Source GUID could not be resolved; may be built-in or an unavailable package.");
                return;
            }
            descriptor["sourcePath"] = Path.GetRelativePath(project, file).Replace('\\', '/');
            string extension = Path.GetExtension(file).ToLowerInvariant();
            long size = new FileInfo(file).Length;
            descriptor["byteLength"] = size;
            if (size > 64 * 1024 * 1024)
            {
                descriptor["limitations"] = new JsonArray("Asset exceeds the 64 MiB evidence limit.");
                return;
            }
            byte[] bytes = File.ReadAllBytes(file);
            string hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            descriptor["sourceHash"] = hash;
            descriptor["status"] = "source-evidence";
            try
            {
                string metadata = file + ".meta";
                if (File.Exists(metadata))
                {
                    descriptor["importer"] = Sanitize(UnityYaml.ParseMetadata(File.ReadAllText(metadata))!);
                }
                if (new[] { ".png", ".jpg", ".jpeg", ".tga", ".psd", ".exr", ".tif", ".tiff", ".dds", ".ttf", ".otf", ".ttc" }.Contains(extension))
                {
                    descriptor["kind"] = extension is ".ttf" or ".otf" or ".ttc" ? "font" : "texture";
                    Directory.CreateDirectory(Path.Combine(output, "blobs"));
                    string relative = "blobs/" + hash + extension;
                    File.WriteAllBytes(Path.Combine(output, relative), bytes);
                    descriptor["blob"] = new JsonObject { ["file"] = relative, ["sha256"] = hash, ["byteLength"] = bytes.Length, ["extension"] = extension };
                    if (extension == ".png" && bytes.Length >= 24 && bytes.Take(8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
                    {
                        descriptor["width"] = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
                        descriptor["height"] = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
                    }
                }
                else if (new[] { ".shader", ".hlsl", ".cginc", ".shadergraph", ".shadersubgraph" }.Contains(extension))
                {
                    descriptor["kind"] = "shader-description";
                    descriptor["implementation"] = DescribeShader(System.Text.Encoding.UTF8.GetString(bytes));
                    descriptor["status"] = "analysis-required";
                }
                else if (new[] { ".mat", ".anim", ".controller", ".overridecontroller", ".asset" }.Contains(extension))
                {
                    descriptor["kind"] = extension == ".mat" ? "material" : extension == ".anim" ? "animation" : extension.Contains("controller") ? "animation-controller" : "serialized-asset";
                    JsonArray records = new();
                    foreach (UnityYaml.AssetObject item in UnityYaml.Parse(System.Text.Encoding.UTF8.GetString(bytes)).Values)
                    {
                        if (item.ClassId == 114)
                        {
                            descriptor["limitations"] = new JsonArray("Custom/optional-package serialized script data excluded; adapter required.");
                            descriptor["status"] = "adapter-required";
                            continue;
                        }
                        records.Add(new JsonObject { ["fileId"] = item.Id, ["classId"] = item.ClassId, ["parameters"] = Sanitize(item.Data) });
                    }
                    descriptor["records"] = records;
                }
                else
                {
                    descriptor["status"] = "adapter-required";
                    descriptor["limitations"] = new JsonArray("Source fingerprint only; no parser for this asset format.");
                }
                JsonArray dependencies = References(descriptor);
                descriptor["dependencies"] = dependencies;
                foreach (JsonNode? dependency in dependencies)
                {
                    Collect(dependency!.ToString());
                }
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                descriptor["status"] = "parse-failed";
                descriptor["limitations"] = new JsonArray(error.Message);
            }
        }

        private static JsonArray References(JsonNode value)
        {
            HashSet<string> result = new(StringComparer.Ordinal);
            void Walk(JsonNode? node)
            {
                if (node is JsonObject map)
                {
                    if (map["guid"] is JsonValue guid && guid.ToString().Length == 32 && map.ContainsKey("fileID"))
                    {
                        result.Add(guid.ToString());
                    }
                    foreach (KeyValuePair<string, JsonNode?> pair in map)
                    {
                        Walk(pair.Value);
                    }
                }
                else if (node is JsonArray array)
                {
                    foreach (JsonNode? child in array)
                    {
                        Walk(child);
                    }
                }
            }
            Walk(value);
            return new JsonArray(result.Order(StringComparer.Ordinal).Select(value => JsonValue.Create(value) as JsonNode).ToArray());
        }

        private static JsonNode Sanitize(JsonNode source)
        {
            if (source is JsonObject map)
            {
                JsonObject result = new();
                foreach (KeyValuePair<string, JsonNode?> pair in map)
                {
                    if (new[] { "m_Script", "m_GameObject", "m_CorrespondingSourceObject", "m_PrefabInstance", "m_PrefabAsset", "m_Events", "m_PersistentCalls", "m_StateMachineBehaviours" }.Contains(pair.Key))
                    {
                        continue;
                    }
                    result[pair.Key] = pair.Value == null ? null : Sanitize(pair.Value);
                }
                return result;
            }
            if (source is JsonArray array)
            {
                return new JsonArray(array.Select(value => value == null ? null : Sanitize(value)).ToArray());
            }
            return source.DeepClone();
        }

        private static JsonObject DescribeShader(string text)
        {
            // Tokens are evidence, not a claim of pixel-equivalent shader reconstruction.
            JsonArray cues = new();
            foreach ((string token, string meaning) in new[]
            {
                ("tex2D", "Texture sampling observed; resolve channels and coordinate transforms."),
                ("SAMPLE_TEXTURE2D", "Texture sampling observed; target pipeline adapter required."),
                ("_Time", "Time input observed; inspect scrolling/pulsing before reconstruction."),
                ("clip(", "Fragment clipping observed; recover threshold and mask inputs."),
                ("UNITY_UI_CLIP_RECT", "UI rectangular clipping variant observed."),
                ("Stencil", "Stencil state observed; preserve UI masking semantics.")
            })
            {
                if (text.Contains(token, StringComparison.Ordinal))
                {
                    cues.Add(new JsonObject { ["evidenceToken"] = token, ["interpretation"] = meaning, ["confidence"] = "token-only" });
                }
            }
            return new JsonObject
            {
                ["renderStates"] = new JsonArray(Regex.Matches(text, @"(?m)^\s*(Blend|Cull|ZWrite|ZTest|ColorMask)\s+([^\r\n{}]+)").Select(match => JsonValue.Create(match.Value.Trim()) as JsonNode).ToArray()),
                ["cues"] = cues,
                ["includes"] = new JsonArray(Regex.Matches(text, "#include\\s+[\"<]([^\">]+)").Select(match => JsonValue.Create(match.Groups[1].Value) as JsonNode).ToArray()),
                ["limitations"] = "Original implementation is not copied. Sampling equations, macros, include implementations and Graph semantics require analysis and target rendering validation."
            };
        }
    }
}
