using System.Text.Json.Nodes;

namespace GameCLI.Services.UiLibrary
{
    /// <summary>Compares stable identities and permits only exact, externally reviewed changes.</summary>
    public static class UiChangeGuard
    {
        public static JsonObject Normalize(JsonObject snapshot)
        {
            if ((string?)snapshot["schemaVersion"] != "ui-template/1")
            {
                throw new InvalidDataException("Expected ui-template/1 baseline and candidate.");
            }
            JsonObject result = (JsonObject)snapshot.DeepClone();
            JsonObject prefab = result["prefab"]!.AsObject();
            JsonObject nodes = Index(prefab["nodes"]!.AsArray());
            foreach (JsonNode? item in nodes.Select(pair => pair.Value))
            {
                JsonObject node = item!.AsObject();
                node["components"] = Index(node["components"]!.AsArray());
            }
            prefab["nodes"] = nodes;
            return result;
        }

        private static JsonObject Index(JsonArray values)
        {
            JsonObject result = new();
            foreach (JsonNode? value in values)
            {
                string id = (string?)value?["id"] ?? "";
                if (string.IsNullOrWhiteSpace(id) || result.ContainsKey(id))
                {
                    throw new InvalidDataException("Duplicate or missing stable ID.");
                }
                result[id] = value!.DeepClone();
            }
            return result;
        }

        public static JsonArray Diff(JsonNode? before, JsonNode? after, string path = "")
        {
            JsonArray changes = new();
            if (JsonValueEquality.Equal(before, after))
            {
                return changes;
            }
            if (before is JsonObject left && after is JsonObject right)
            {
                foreach (string key in left.Select(pair => pair.Key).Union(right.Select(pair => pair.Key)).Order(StringComparer.Ordinal))
                {
                    string next = path + "/" + key.Replace("~", "~0").Replace("/", "~1");
                    bool had = left.ContainsKey(key);
                    bool has = right.ContainsKey(key);
                    if (!had || !has)
                    {
                        changes.Add(Change(next, had, left[key], has, right[key]));
                    }
                    else
                    {
                        foreach (JsonNode? change in Diff(left[key], right[key], next))
                        {
                            changes.Add(change!.DeepClone());
                        }
                    }
                }
            }
            else
            {
                changes.Add(Change(path, true, before, true, after));
            }
            return changes;
        }

        private static JsonObject Change(string path, bool beforeExists, JsonNode? before, bool afterExists, JsonNode? after)
        {
            return new JsonObject
            {
                ["path"] = path,
                ["beforeExists"] = beforeExists,
                ["before"] = before?.DeepClone(),
                ["afterExists"] = afterExists,
                ["after"] = after?.DeepClone()
            };
        }

        public static JsonObject Compile(string baseline, string candidate, JsonObject approval)
        {
            string[] required = { "schemaVersion", "sourceSha256", "outputPrefab", "authorizationReference", "changes" };
            if (approval.Count != required.Length || required.Any(key => !approval.ContainsKey(key)))
            {
                throw new InvalidDataException("Unexpected or missing approval fields.");
            }
            JsonObject source = Normalize(JsonNode.Parse(baseline)!.AsObject());
            JsonObject target = Normalize(JsonNode.Parse(candidate)!.AsObject());
            JsonArray changes = Diff(source, target);
            if ((string?)approval["schemaVersion"] != "ui-change-approval/1"
                || (string?)approval["sourceSha256"] != AssemblyPlanCompiler.Hash(baseline)
                || string.IsNullOrWhiteSpace((string?)approval["authorizationReference"]))
            {
                throw new InvalidDataException("Approval must pin the source hash and reference the user's instruction.");
            }
            JsonArray allowed = approval["changes"]?.AsArray() ?? throw new InvalidDataException("Missing exact change list.");
            JsonArray effective = EffectiveChanges(allowed, source, target);
            if (!JsonValueEquality.Equal(changes, effective))
            {
                throw new InvalidDataException("Candidate differs from the authorized change list. Run audit; do not auto-approve its output.");
            }
            string output = (string?)approval["outputPrefab"] ?? "";
            if (!output.StartsWith("Assets/", StringComparison.Ordinal) || !output.EndsWith(".prefab", StringComparison.Ordinal)
                || output.Contains(':') || output.Contains('\\') || output.Split('/').Any(part => part is "" or "." or "..")
                || !Path.GetFileName(output).StartsWith("UI", StringComparison.Ordinal))
            {
                throw new InvalidDataException("Output must be Assets/.../UIName.prefab.");
            }
            // This is a consistency envelope, not a signature proving human identity.
            return new JsonObject
            {
                ["schemaVersion"] = "ui-assembly/2",
                ["adapterVersion"] = "authorized-changes/1",
                ["baselineJson"] = baseline,
                ["sourceSha256"] = AssemblyPlanCompiler.Hash(baseline),
                ["snapshotJson"] = candidate,
                ["snapshotSha256"] = AssemblyPlanCompiler.Hash(candidate),
                ["approvalJson"] = approval.ToJsonString(),
                ["approvalSha256"] = AssemblyPlanCompiler.Hash(approval.ToJsonString()),
                ["outputPrefab"] = output
            };
        }

        private static JsonArray EffectiveChanges(JsonArray allowed, JsonObject source, JsonObject target)
        {
            JsonArray result = new();
            HashSet<string> paths = new(StringComparer.Ordinal);
            foreach (JsonNode? item in allowed)
            {
                JsonObject change = item?.AsObject() ?? throw new InvalidDataException("Invalid approval change.");
                string path = (string?)change["path"] ?? "";
                if (change.Count != 5 || !paths.Add(path))
                {
                    throw new InvalidDataException("Duplicate or invalid approval change.");
                }
                bool beforeExists = change["beforeExists"]!.GetValue<bool>();
                bool afterExists = change["afterExists"]!.GetValue<bool>();
                // Historical approvals may contain a number spelling change. Ignore it only
                // when both immutable snapshots prove that the exact field already has that value.
                if (beforeExists && afterExists && JsonValueEquality.Equal(change["before"], change["after"]))
                {
                    if (!TryResolve(source, path, out JsonNode? before) || !TryResolve(target, path, out JsonNode? after)
                        || !JsonValueEquality.Equal(before, change["before"]) || !JsonValueEquality.Equal(after, change["after"]))
                    {
                        throw new InvalidDataException("No-op approval does not match the pinned snapshots.");
                    }
                    continue;
                }
                result.Add(change.DeepClone());
            }
            return result;
        }

        private static bool TryResolve(JsonNode root, string path, out JsonNode? value)
        {
            value = root;
            if (!path.StartsWith('/'))
            {
                return false;
            }
            foreach (string part in path[1..].Split('/'))
            {
                string key = part.Replace("~1", "/").Replace("~0", "~");
                if (value is not JsonObject obj || !obj.ContainsKey(key))
                {
                    return false;
                }
                value = obj[key];
            }
            return true;
        }
    }
}
