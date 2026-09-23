using System.Text.Json;
using System.Text.Json.Serialization;

namespace GameCLI.Contracts
{
    internal sealed record PmTask(string Id, string Title, string[] Acceptance, string[] DependsOn);

    internal sealed record PmData(string Spec, PmTask[] Tasks, string[] Acceptance, string[] ArtManifest, string[] Questions, bool HumanGate);

    internal sealed record PmError(string Category, string Message, string? Evidence, bool Retryable);

    internal sealed record PmAnalysis(int SchemaVersion, string? IssueKey, string TraceId, string ExecutionId, string Status, PmData Data, string[] Artifacts, PmError[] Errors);

    internal static class PmContract
    {
        public static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
        };

        /// <summary>Gets the strict output schema for a draft without JIRA transitions or created artifacts.</summary>
        public static JsonElement Schema => JsonSerializer.SerializeToElement(Object(new Dictionary<string, object>
        {
            ["schema_version"] = new
            {
                type = "integer",
                @enum = new[]
                {
                    1
                }
            },
            ["issue_key"] = new
            {
                type = "null"
            },
            ["trace_id"] = Text(),
            ["execution_id"] = Text(),
            ["status"] = new
            {
                type = "string",
                @enum = new[]
                {
                    "success",
                    "blocked",
                    "failed"
                }
            },
            ["artifacts"] = new
            {
                type = "array",
                items = Text(),
                maxItems = 0
            },
            ["errors"] = new
            {
                type = "array",
                items = Object(new Dictionary<string, object>
                {
                    ["category"] = Text(),
                    ["message"] = Text(),
                    ["evidence"] = new
                    {
                        type = new[]
                        {
                            "string",
                            "null"
                        }
                    },
                    ["retryable"] = new
                    {
                        type = "boolean"
                    }
                })
            },
            ["data"] = Object(new Dictionary<string, object>
            {
                ["spec"] = Text(),
                ["tasks"] = new
                {
                    type = "array",
                    items = Object(new Dictionary<string, object>
                    {
                        ["id"] = Text(),
                        ["title"] = Text(),
                        ["acceptance"] = Strings(),
                        ["depends_on"] = Strings()
                    })
                },
                ["acceptance"] = Strings(),
                ["art_manifest"] = Strings(),
                ["questions"] = Strings(),
                ["human_gate"] = new
                {
                    type = "boolean",
                    @enum = new[]
                    {
                        true
                    }
                }
            })
        }));

        private static object Text()
        {
            return new
            {
                type = "string"
            };
        }

        private static object Strings()
        {
            return new
            {
                type = "array",
                items = Text()
            };
        }

        private static object Object(Dictionary<string, object> properties)
        {
            return new
            {
                type = "object",
                properties,
                required = properties.Keys.ToArray(),
                additionalProperties = false
            };
        }

        /// <summary>Validates shape, execution identity, and an acyclic task dependency graph.</summary>
        /// <exception cref="JsonException">The result violates the PM draft contract.</exception>
        public static PmAnalysis Parse(string text, string traceId, string executionId)
        {
            using JsonDocument document = JsonDocument.Parse(text);
            CheckShape(document.RootElement, Schema);
            PmAnalysis result = JsonSerializer.Deserialize<PmAnalysis>(text, JsonOptions) ?? throw new JsonException("Missing PM result.");
            if (result.TraceId != traceId || result.ExecutionId != executionId || string.IsNullOrWhiteSpace(result.Data.Spec) || result.Artifacts.Length != 0)
            {
                throw new JsonException("PM result identity or specification is invalid.");
            }

            Dictionary<string, PmTask> tasks = new(StringComparer.Ordinal);
            foreach (PmTask task in result.Data.Tasks)
            {
                if (string.IsNullOrWhiteSpace(task.Id) || string.IsNullOrWhiteSpace(task.Title) || task.Acceptance.Length == 0 || !tasks.TryAdd(task.Id, task))
                {
                    throw new JsonException("PM tasks need unique IDs, titles and acceptance criteria.");
                }
            }

            HashSet<string> visited = new(StringComparer.Ordinal);
            HashSet<string> active = new(StringComparer.Ordinal);
            foreach (string id in tasks.Keys)
            {
                Visit(id, tasks, visited, active);
            }

            if (result.Status == "success" && (tasks.Count == 0 || result.Data.Acceptance.Length == 0))
            {
                throw new JsonException("Successful analysis requires tasks and acceptance criteria.");
            }

            return result;
        }

        private static void Visit(string id, Dictionary<string, PmTask> tasks, HashSet<string> visited, HashSet<string> active)
        {
            if (visited.Contains(id))
            {
                return;
            }

            if (!tasks.TryGetValue(id, out PmTask? task) || !active.Add(id))
            {
                throw new JsonException("PM task dependency is missing or cyclic.");
            }

            foreach (string dependency in task.DependsOn)
            {
                Visit(dependency, tasks, visited, active);
            }

            active.Remove(id);
            visited.Add(id);
        }

        // Validate the exact schema subset we generate, including required fields and nested arrays.
        private static void CheckShape(JsonElement value, JsonElement schema)
        {
            JsonElement typeValue = schema.GetProperty("type");
            if (typeValue.ValueKind == JsonValueKind.Array)
            {
                if (value.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                {
                    throw new JsonException("Invalid nullable evidence.");
                }

                return;
            }

            string? type = typeValue.GetString();
            bool valid = type switch
            {
                "object" => value.ValueKind == JsonValueKind.Object,
                "array" => value.ValueKind == JsonValueKind.Array,
                "string" => value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()),
                "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out _),
                "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                "null" => value.ValueKind == JsonValueKind.Null,
                _ => false
            };
            if (!valid || (schema.TryGetProperty("enum", out JsonElement choices) && !choices.EnumerateArray().Any(choice => choice.GetRawText() == value.GetRawText())))
            {
                throw new JsonException("PM result does not match its output contract.");
            }

            if (type == "object")
            {
                JsonElement properties = schema.GetProperty("properties");
                if (value.EnumerateObject().Count() != properties.EnumerateObject().Count())
                {
                    throw new JsonException("PM result has missing or unexpected fields.");
                }

                foreach (JsonProperty property in properties.EnumerateObject())
                {
                    if (!value.TryGetProperty(property.Name, out JsonElement child))
                    {
                        throw new JsonException("PM result is missing a required field.");
                    }

                    CheckShape(child, property.Value);
                }
            }
            else if (type == "array")
            {
                foreach (JsonElement child in value.EnumerateArray())
                {
                    CheckShape(child, schema.GetProperty("items"));
                }
            }
        }
    }
}
