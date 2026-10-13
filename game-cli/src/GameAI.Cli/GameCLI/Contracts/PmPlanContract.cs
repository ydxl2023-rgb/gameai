using System.Text.Json;

namespace GameCLI.Contracts
{
    /// <summary>Structured proposal only; the cloud service validates and publishes tasks.</summary>
    internal static class PmPlanContract
    {
        public static JsonElement Schema
        { get; } = JsonDocument.Parse("""
            {
              "type":"object","additionalProperties":false,"required":["outcome","issues","summary","tasks"],
              "properties":{
                "outcome":{"type":"string","enum":["ready","revision_required","needs_input","execution_error"]},
                "issues":{"type":"array","items":{"type":"object","additionalProperties":false,
                  "required":["section","evidence","impact","suggestion"],"properties":{
                    "section":{"type":"string"},"evidence":{"type":"string"},"impact":{"type":"string"},"suggestion":{"type":"string"}}}},
                "summary":{"type":"string"},
                "tasks":{"type":"array","items":{
                  "type":"object","additionalProperties":false,
                  "required":["id","title","role","description","source_refs","acceptance","depends_on"],
                  "properties":{
                    "id":{"type":"string"},"title":{"type":"string"},
                    "role":{"type":"string","enum":["Prefab","Art","Development","QA"]},
                    "description":{"type":"string"},
                    "source_refs":{"type":"array","items":{"type":"string"}},
                    "depends_on":{"type":"array","items":{"type":"string"}},
                    "acceptance":{"type":"object","additionalProperties":false,
                      "required":["preconditions","steps","success","failure","recovery","tests"],
                      "properties":{
                        "preconditions":{"type":"string"},"steps":{"type":"string"},
                        "success":{"type":"string"},"failure":{"type":"string"},
                        "recovery":{"type":"string"},"tests":{"type":"string"}
                      }
                    }
                  }
                }}
              }
            }
            """).RootElement.Clone();
    }
}
