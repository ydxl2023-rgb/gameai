using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Builds source-owned obligations and checks complete, fresh Unity evidence.</summary>
    public static class VerificationContract
    {
        public static string Hash(string value)
        {
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
        }

        public static JsonObject Build(string source, string inventory, JsonArray? additional = null, string? manifestText = null)
        {
            JsonObject snapshot = JsonNode.Parse(source)!.AsObject();
            JsonObject visual = JsonNode.Parse(inventory)!.AsObject();
            JsonArray sourceNodes = snapshot["prefab"]?["nodes"]?.AsArray() ?? throw new InvalidDataException("Resolved source nodes required.");
            Dictionary<string, JsonNode> nodes = sourceNodes.ToDictionary(n => n!["id"]!.GetValue<string>(), n => n!);
            JsonObject paths = new();
            JsonArray checks = new();
            HashSet<string> uniquePaths = new(StringComparer.Ordinal);
            foreach ((string id, JsonNode node) in nodes)
            {
                List<string> names = new();
                HashSet<string> visited = new(StringComparer.Ordinal);
                JsonNode cursor = node;
                while (cursor["parentId"] != null)
                {
                    if (!visited.Add(cursor["id"]!.GetValue<string>()))
                    {
                        throw new InvalidDataException("Source hierarchy cycle.");
                    }
                    names.Insert(0, cursor["name"]!.GetValue<string>());
                    cursor = nodes[cursor["parentId"]!.GetValue<string>()];
                }
                string path = string.Join('/', names);
                if (names.Any(n => n.Contains('/')) || !uniquePaths.Add(path))
                {
                    throw new InvalidDataException("Ambiguous Unity hierarchy path: " + path);
                }
                paths[id] = path;
                JsonObject nodeCheck = Check(id + ":node", "node", id);
                nodeCheck["active"] = node["active"]?.DeepClone();
                nodeCheck["siblingIndex"] = node["siblingIndex"]?.DeepClone();
                checks.Add(nodeCheck);
                if (node["rect"] is JsonObject rect)
                {
                    foreach ((string key, JsonNode? value) in rect)
                    {
                        if (value is JsonArray vector && vector.Count == 2)
                        {
                            string unityName = "m_" + char.ToUpperInvariant(key[0]) + key[1..];
                            for (int axis = 0; axis < 2; axis++)
                            {
                                JsonObject check = Check(id + ":rect:" + key + axis, "property", id, "UnityEngine.RectTransform");
                                check["property"] = unityName + (axis == 0 ? ".x" : ".y");
                                check["expected"] = vector[axis]!.DeepClone();
                                check["tolerance"] = 0.001;
                                checks.Add(check);
                            }
                        }
                    }
                }
                foreach (JsonNode? component in node["components"]!.AsArray())
                {
                    checks.Add(Check(id + ":component:" + component!["id"], "component", id, component["type"]!.GetValue<string>()));
                }
            }
            // The raw inventory is mandatory: a static projection alone silently loses Animator and custom components.
            JsonArray entries = visual["sourceComponentInventory"]?.AsArray() ?? throw new InvalidDataException("Complete component inventory required.");
            foreach (JsonNode? entry in entries)
            {
                string id = entry!["nodeId"]!.GetValue<string>();
                string checkId = "inventory:" + id + ":" + entry["componentId"];
                int classId = entry["classId"]!.GetValue<int>();
                string status = entry["status"]?.GetValue<string>() ?? "unknown";
                if (!nodes.ContainsKey(id))
                {
                    throw new InvalidDataException("Inventory refers to unresolved node " + id);
                }
                if (classId == 95)
                {
                    checks.Add(Check(checkId, "animator.controller", id));
                    AddAnimationChecks(checks, paths, entry, checkId, manifestText);
                }
                else if (classId == 198)
                {
                    checks.Add(Check(checkId, "component", id, "UnityEngine.ParticleSystem"));
                }
                else if (status != "captured" || entry["requiresPrinciple"]?.GetValue<bool>() == true)
                {
                    JsonObject check = Check(checkId, "unsupported", id);
                    check["reason"] = "Source component requires an explicit adaptation verification: " + entry["scriptGuid"];
                    checks.Add(check);
                }
            }
            foreach (JsonNode? check in additional ?? new JsonArray())
            {
                checks.Add(check!.DeepClone());
            }
            JsonObject contract = new()
            {
                ["schemaVersion"] = "ui-verification-contract/1", ["sourceSha256"] = Hash(source),
                ["inventorySha256"] = Hash(inventory), ["nodes"] = paths, ["checks"] = checks
            };
            contract["manifestSha256"] = manifestText == null ? null : Hash(manifestText);
            Validate(contract);
            return contract;
        }

        public static void Validate(JsonObject contract)
        {
            if ((string?)contract["schemaVersion"] != "ui-verification-contract/1" || contract["nodes"] is not JsonObject nodes
                || contract["checks"] is not JsonArray checks || checks.Count == 0)
            {
                throw new InvalidDataException("Invalid or empty verification contract.");
            }
            HashSet<string> ids = new(StringComparer.Ordinal);
            foreach (JsonNode? check in checks)
            {
                string id = (string?)check?["id"] ?? "";
                if (string.IsNullOrWhiteSpace(id) || !ids.Add(id) || !nodes.ContainsKey((string?)check?["nodeId"] ?? ""))
                {
                    throw new InvalidDataException("Duplicate check or unresolved target: " + id);
                }
            }
        }

        public static JsonObject Verify(string contractText, JsonObject report, string project)
        {
            JsonObject contract = JsonNode.Parse(contractText)!.AsObject();
            Validate(contract);
            JsonArray errors = new();
            if ((string?)report["schemaVersion"] != "ui-verification-evidence/1" || (string?)report["contractSha256"] != Hash(contractText))
            {
                errors.Add("Evidence is not bound to this contract.");
            }
            JsonArray actual = report["checks"]?.AsArray() ?? new JsonArray();
            foreach (JsonNode? required in contract["checks"]!.AsArray())
            {
                if ((string?)required!["kind"] == "unsupported")
                {
                    errors.Add("Unresolved source obligation: " + required["id"]);
                }
                JsonNode?[] matches = actual.Where(c => (string?)c?["id"] == (string?)required!["id"]).ToArray();
                if (matches.Length != 1 || (string?)matches[0]?["status"] != "passed")
                {
                    errors.Add("Missing, duplicate, failed or unverified check: " + required!["id"]);
                }
            }
            if (actual.Count != contract["checks"]!.AsArray().Count)
            {
                errors.Add("Evidence check count differs from contract.");
            }
            JsonArray dependencies = report["dependencies"]?.AsArray() ?? new JsonArray();
            if (dependencies.Count == 0 || !dependencies.Any(d => (string?)d?["path"] == (string?)report["prefabPath"]))
            {
                errors.Add("Missing target asset fingerprints.");
            }
            string root = Path.GetFullPath(project).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (JsonNode? dependency in dependencies)
            {
                string path = Path.GetFullPath(Path.Combine(root, (dependency!["storagePath"] ?? dependency["path"])!.GetValue<string>()));
                if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)
                    || Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant() != (string?)dependency["sha256"])
                {
                    errors.Add("Missing or changed dependency: " + dependency["path"]);
                }
            }
            return new JsonObject { ["schemaVersion"] = "ui-delivery-verification/1", ["passed"] = errors.Count == 0, ["errors"] = errors };
        }

        private static JsonObject Check(string id, string kind, string node, string? component = null)
        {
            JsonObject result = new() { ["id"] = id, ["kind"] = kind, ["nodeId"] = node };
            if (component != null)
            {
                result["component"] = component;
            }
            return result;
        }

        private static void AddAnimationChecks(JsonArray checks, JsonObject paths, JsonNode entry, string prefix, string? manifestText)
        {
            string owner = entry["nodeId"]!.GetValue<string>();
            try
            {
                JsonArray resources = JsonNode.Parse(manifestText ?? "{}")?["visualResources"]?.AsArray()
                    ?? throw new InvalidDataException("Source resource manifest is required for animation coverage.");
                string guid = entry["parameters"]!["m_Controller"]!["guid"]!.GetValue<string>();
                JsonNode controller = resources.Single(r => (string?)r?["id"] == guid)!;
                JsonNode controllerParameters = controller["records"]!.AsArray().Single(r => (int?)r?["classId"] == 91)!["parameters"]!;
                if (controllerParameters["m_AnimatorLayers"]!.AsArray().Count != 1
                    || controller["records"]!.AsArray().Any(r => (int?)r?["classId"] == 1101))
                {
                    throw new InvalidDataException("Multiple layers or transitions require an additional source adapter.");
                }
                JsonNode[] states = controller["records"]!.AsArray().Where(r => (int?)r?["classId"] == 1102).Select(r => r!["parameters"]!).ToArray();
                if (states.Length != 1 || states[0]["m_Transitions"]!.AsArray().Count != 0
                    || (double?)states[0]["m_Speed"] != 1 || (double?)states[0]["m_CycleOffset"] != 0
                    || (int?)states[0]["m_SpeedParameterActive"] == 1 || (int?)states[0]["m_TimeParameterActive"] == 1)
                {
                    throw new InvalidDataException("Complex state machines require an additional source adapter.");
                }
                string clipId = states[0]["m_Motion"]!["guid"]!.GetValue<string>();
                JsonNode clip = resources.Single(r => (string?)r?["id"] == clipId)!["records"]![0]!["parameters"]!;
                double duration = clip["m_AnimationClipSettings"]!["m_StopTime"]!.GetValue<double>();
                bool loop = (int?)clip["m_AnimationClipSettings"]!["m_LoopTime"] == 1;
                string name = clip["m_Name"]!.GetValue<string>();
                JsonObject clipCheck = Check(prefix + ":clip", "animation.clip", owner);
                clipCheck["clip"] = name;
                clipCheck["duration"] = duration;
                clipCheck["loop"] = loop;
                checks.Add(clipCheck);
                foreach (string unsupported in new[] { "m_RotationCurves", "m_CompressedRotationCurves", "m_FloatCurves", "m_PPtrCurves", "m_Events" })
                {
                    if (clip[unsupported] is JsonArray items && items.Count > 0)
                    {
                        throw new InvalidDataException("Source channel needs an adapter: " + unsupported);
                    }
                }
                int sequence = 0;
                foreach (string channel in new[] { "m_ScaleCurves", "m_PositionCurves", "m_EulerCurves" })
                {
                    foreach (JsonNode? curve in clip[channel]?.AsArray() ?? new JsonArray())
                    {
                        string relative = (string?)curve!["path"] ?? "";
                        string path = string.Join('/', new[] { (string?)paths[owner], relative }.Where(s => !string.IsNullOrEmpty(s)));
                        string target = paths.Single(p => (string?)p.Value == path).Key;
                        JsonArray keys = curve["curve"]!["m_Curve"]!.AsArray();
                        if (keys.Count < 2 || keys.Any(k => (int?)k?["weightedMode"] != 0))
                        {
                            throw new InvalidDataException("Weighted or degenerate curves require an adapter.");
                        }
                        foreach (string axis in new[] { "x", "y", "z" })
                        {
                            string property = channel == "m_ScaleCurves" ? "m_LocalScale." + axis
                                : channel == "m_PositionCurves" ? "m_LocalPosition." + axis : "localEulerAngles." + axis;
                            for (int i = 0; i < keys.Count - 1; i++)
                            {
                                JsonNode a = keys[i]!;
                                JsonNode b = keys[i + 1]!;
                                double t0 = a["time"]!.GetValue<double>();
                                double t1 = b["time"]!.GetValue<double>();
                                foreach (double u in new[] { 0.0, 0.5, 1.0 })
                                {
                                    double value = (2*u*u*u-3*u*u+1)*a["value"]![axis]!.GetValue<double>()
                                        + (u*u*u-2*u*u+u)*(t1-t0)*a["outSlope"]![axis]!.GetValue<double>()
                                        + (-2*u*u*u+3*u*u)*b["value"]![axis]!.GetValue<double>()
                                        + (u*u*u-u*u)*(t1-t0)*b["inSlope"]![axis]!.GetValue<double>();
                                    foreach (double cycle in loop ? new[] { 0.0, duration } : new[] { 0.0 })
                                    {
                                        JsonObject sample = Check(prefix + ":sample:" + sequence++, "animation.sample", target, "UnityEngine.Transform");
                                        sample["animatorNodeId"] = owner;
                                        sample["property"] = property;
                                        sample["timeSeconds"] = t0 + u*(t1-t0) + cycle;
                                        sample["expected"] = value;
                                        sample["tolerance"] = channel == "m_EulerCurves" ? 0.2 : 0.002;
                                        checks.Add(sample);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception error) when (error is InvalidDataException or InvalidOperationException or NullReferenceException or KeyNotFoundException)
            {
                JsonObject gap = Check(prefix + ":source-coverage", "unsupported", owner);
                gap["reason"] = error.Message;
                checks.Add(gap);
            }
        }
    }
}
