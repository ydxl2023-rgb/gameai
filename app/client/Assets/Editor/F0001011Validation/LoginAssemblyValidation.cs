using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace GameAI.Validation
{
    /// <summary>Runs task-scoped checks in an isolated preview scene without editing production assets.</summary>
    public static class LoginAssemblyValidation
    {
        private const string PrefabPath = "Assets/UI/Widgets/UILogin/UILogin.prefab";
        private const int Width = 1920;
        private const int Height = 1080;

        [InitializeOnLoadMethod]
        private static void Schedule()
        {
            EditorApplication.update += RunRequested;
        }

        private static void RunRequested()
        {
            string repository = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
            string request = Path.Combine(repository, "game-cli/temp/94ba78f0a86546ac8549a633a79cbfd2/run-validation.json");
            if (!File.Exists(request))
            {
                return;
            }
            File.Move(request, request + ".consumed");
            string directory = Path.Combine(repository, "deliveries/F-0001011/retry-94ba78f0");
            JObject report = new JObject
            {
                ["utc"] = DateTime.UtcNow.ToString("O"),
                ["unity"] = Application.unityVersion,
                ["environment"] = "Editor isolated WorldSpace Canvas; orthographic camera; native UGUI touch raycast pipeline",
                ["width"] = Width,
                ["height"] = Height,
                ["simulatedSafeArea"] = new JArray(80, 40, 1760, 1040),
                ["safeAreaSource"] = "Approved project synthetic profile: landscape-1920-safe80x40-v1; not a physical device or Screen.safeArea measurement",
                ["productionPrefabModified"] = false
            };
            Scene scene = EditorSceneManager.NewPreviewScene();
            EventSystem previousEvents = EventSystem.current;
            RenderTexture previousTexture = RenderTexture.active;
            RenderTexture texture = null;
            try
            {
                GameObject cameraObject = new GameObject("ValidationCamera", typeof(Camera));
                SceneManager.MoveGameObjectToScene(cameraObject, scene);
                Camera camera = cameraObject.GetComponent<Camera>();
                camera.scene = scene;
                camera.transform.position = new Vector3(0, 0, -1000);
                camera.orthographic = true;
                camera.orthographicSize = Height / 2f;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 2000;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.black;
                texture = new RenderTexture(Width, Height, 24);
                camera.targetTexture = texture;
                GameObject host = new GameObject("ValidationCanvas", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
                SceneManager.MoveGameObjectToScene(host, scene);
                Canvas canvas = host.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.WorldSpace;
                canvas.worldCamera = camera;
                typeof(BaseRaycaster).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(host.GetComponent<GraphicRaycaster>(), null);
                host.GetComponent<RectTransform>().sizeDelta = new Vector2(Width, Height);
                GameObject root = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath), scene);
                root.transform.SetParent(host.transform, false);
                GameObject eventsObject = new GameObject("ValidationEvents", typeof(EventSystem), typeof(StandaloneInputModule));
                SceneManager.MoveGameObjectToScene(eventsObject, scene);
                EventSystem events = eventsObject.GetComponent<EventSystem>();
                events.sendNavigationEvents = false;
                // Editor-only components need the lifecycle registration normally performed in Play Mode.
                typeof(EventSystem).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(events, null);
                EventSystem.current = events;
                StandaloneInputModule module = eventsObject.GetComponent<StandaloneInputModule>();
                SimulatedTouchModule.InitializeForEditor(module);
                JObject frozen = JObject.Parse(File.ReadAllText(Path.Combine(repository, "game-cli/temp/task-jobs/94ba78f0-a865-46ac-8549-a633a79cbfd2/production-input.json")));
                JObject paths = (JObject)JObject.Parse(File.ReadAllText(Path.Combine(directory, "verification-contract.json")))["nodes"];
                JArray fonts = new JArray();
                foreach (Text text in root.GetComponentsInChildren<Text>(true))
                {
                    fonts.Add(new JObject
                    {
                        ["path"] = RelativePath(text.transform, root.transform),
                        ["assetPath"] = AssetDatabase.GetAssetPath(text.font)
                    });
                }
                report["fontBindings"] = fonts;
                JArray states = new JArray();
                foreach (JObject state in frozen["window"]["previewStates"])
                {
                    foreach (JProperty active in ((JObject)state["activeNodes"]).Properties())
                    {
                        Resolve(root, (string)paths[active.Name]).gameObject.SetActive((bool)active.Value);
                    }
                    foreach (Animator animator in root.GetComponentsInChildren<Animator>(false))
                    {
                        animator.Rebind();
                        animator.Update(0);
                        animator.Update(1f);
                    }
                    // Match the nested Canvas input camera to the isolated host camera.
                    foreach (Canvas nested in root.GetComponentsInChildren<Canvas>(true))
                    {
                        nested.worldCamera = camera;
                    }
                    foreach (GraphicRaycaster raycaster in root.GetComponentsInChildren<GraphicRaycaster>(false))
                    {
                        typeof(BaseRaycaster).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(raycaster, null);
                    }
                    Canvas.ForceUpdateCanvases();
                    camera.Render();
                    string stateId = (string)state["id"];
                    SaveImage(texture, Path.Combine(directory, "actual-" + stateId + ".png"));
                    JArray texts = new JArray();
                    foreach (Text text in root.GetComponentsInChildren<Text>(false))
                    {
                        texts.Add(new JObject
                        {
                            ["path"] = RelativePath(text.transform, root.transform),
                            ["fontSize"] = text.fontSize,
                            ["bestFit"] = text.resizeTextForBestFit,
                            ["textLength"] = text.text.Length,
                            ["generatedCharacters"] = text.cachedTextGenerator.characterCountVisible,
                            ["preferredHeight"] = text.preferredHeight,
                            ["rectHeight"] = text.rectTransform.rect.height,
                            ["lineCount"] = text.cachedTextGenerator.lineCount
                        });
                    }
                    states.Add(new JObject
                    {
                        ["id"] = stateId,
                        ["texts"] = texts,
                        ["safeAreaChecks"] = CheckSafeArea(root, camera, new Rect(80, 40, 1760, 1040))
                    });
                }
                report["states"] = states;
                report["registeredRaycasters"] = RaycasterManager.GetRaycasters().Count;
                report["registeredGraphics"] = GraphicRegistry.GetRaycastableGraphicsForCanvas(canvas).Count;
                root.transform.Find("queueConfirmView/dequeueConfirmView").gameObject.SetActive(false);
                Dictionary<Button, int> clicks = new Dictionary<Button, int>();
                foreach (Button button in root.GetComponentsInChildren<Button>(true))
                {
                    Button captured = button;
                    clicks.Add(button, 0);
                    button.onClick.AddListener(() =>
                    {
                        clicks[captured]++;
                    });
                }
                string[] buttonPaths =
                {
                    "loginBg/enterGame",
                    "buttonGroup/utilityButtons/announcementButton",
                    "buttonGroup/utilityButtons/logoutButton",
                    "buttonGroup/utilityButtons/repairButton",
                    "buttonGroup/utilityButtons/userCenterButton"
                };
                JArray touches = new JArray();
                Rect safe = new Rect(80, 40, 1760, 1040);
                foreach (string path in buttonPaths)
                {
                    Button button = root.transform.Find(path).GetComponent<Button>();
                    RectTransform hit = button.transform.Find("clickArea") as RectTransform;
                    Vector2 position = camera.WorldToScreenPoint(hit.TransformPoint(hit.rect.center));
                    Canvas.ForceUpdateCanvases();
                    List<RaycastResult> hits = Raycast(events, position);
                    int before = clicks[button];
                    JArray scales = new JArray();
                    for (int repeat = 0; repeat < 2; repeat++)
                    {
                        SimulatedTouchModule.ProcessTouch(module, new Touch
                        {
                            fingerId = 0,
                            position = position,
                            phase = TouchPhase.Began,
                            type = TouchType.Direct
                        });
                        Animator animator = button.GetComponent<Animator>();
                        Advance(animator);
                        scales.Add(button.transform.localScale.x);
                        SimulatedTouchModule.ProcessTouch(module, new Touch
                        {
                            fingerId = 0,
                            position = position,
                            phase = TouchPhase.Ended,
                            type = TouchType.Direct
                        });
                        Advance(animator);
                    }
                    Vector3[] corners = new Vector3[4];
                    hit.GetWorldCorners(corners);
                    bool inside = corners.All(corner => safe.Contains(camera.WorldToScreenPoint(corner)));
                    touches.Add(new JObject
                    {
                        ["path"] = path,
                        ["position"] = new JArray(position.x, position.y),
                        ["hits"] = new JArray(hits.Select(h => RelativePath(h.gameObject.transform, root.transform))),
                        ["clickCount"] = clicks[button] - before,
                        ["pressedScales"] = scales,
                        ["hitPassed"] = clicks[button] - before == 2,
                        ["feedbackPassed"] = scales.All(v => Mathf.Abs((float)v - 0.94f) < 0.005f),
                        ["hitRectInsideSimulatedSafeArea"] = inside
                    });
                }
                report["touches"] = touches;
                Transform tips = root.transform.Find("tips");
                tips.gameObject.SetActive(true);
                foreach (GraphicRaycaster raycaster in tips.GetComponentsInChildren<GraphicRaycaster>(false))
                {
                    typeof(BaseRaycaster).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(raycaster, null);
                }
                foreach (Graphic graphic in tips.GetComponentsInChildren<Graphic>(false))
                {
                    // Edit-mode activation does not run every UGUI lifecycle callback.
                    typeof(Graphic).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(graphic, null);
                    graphic.SetAllDirty();
                    GraphicRegistry.RegisterGraphicForCanvas(graphic.canvas, graphic);
                    if (graphic.raycastTarget)
                    {
                        GraphicRegistry.RegisterRaycastGraphicForCanvas(graphic.canvas, graphic);
                    }
                }
                Canvas.ForceUpdateCanvases();
                camera.Render();
                Button close = tips.Find("tipsBg/closeTips").GetComponent<Button>();
                close.onClick.AddListener(() =>
                {
                    tips.gameObject.SetActive(false);
                });
                Vector2 blockedPosition = camera.WorldToScreenPoint(root.transform.Find("loginBg/enterGame").position);
                int blockedBefore = clicks.Values.Sum();
                SimulatedTouchModule.ProcessTouch(module, new Touch
                {
                    fingerId = 2,
                    position = blockedPosition,
                    phase = TouchPhase.Began,
                    type = TouchType.Direct
                });
                SimulatedTouchModule.ProcessTouch(module, new Touch
                {
                    fingerId = 2,
                    position = blockedPosition,
                    phase = TouchPhase.Ended,
                    type = TouchType.Direct
                });
                report["modalBlocksUnderlyingButton"] = clicks.Values.Sum() == blockedBefore && tips.gameObject.activeSelf;
                Vector2 closePosition = camera.WorldToScreenPoint(close.transform.position);
                List<RaycastResult> closeHits = Raycast(events, closePosition);
                int underlyingBefore = clicks.Where(pair => pair.Key != close).Sum(pair => pair.Value);
                SimulatedTouchModule.ProcessTouch(module, new Touch
                {
                    fingerId = 1,
                    position = closePosition,
                    phase = TouchPhase.Began,
                    type = TouchType.Direct
                });
                SimulatedTouchModule.ProcessTouch(module, new Touch
                {
                    fingerId = 1,
                    position = closePosition,
                    phase = TouchPhase.Ended,
                    type = TouchType.Direct
                });
                int underlyingAfter = clicks.Where(pair => pair.Key != close).Sum(pair => pair.Value);
                report["close"] = new JObject
                {
                    ["position"] = new JArray(closePosition.x, closePosition.y),
                    ["hits"] = new JArray(closeHits.Select(h => RelativePath(h.gameObject.transform, root.transform))),
                    ["closeClicks"] = clicks[close],
                    ["hidden"] = !tips.gameObject.activeSelf,
                    ["underlyingClicks"] = underlyingAfter - underlyingBefore,
                    ["passed"] = clicks[close] == 1 && !tips.gameObject.activeSelf && underlyingAfter == underlyingBefore,
                    ["nestedCanvasRaycasterCount"] = tips.GetComponents<GraphicRaycaster>().Length,
                    ["graphics"] = new JArray(tips.GetComponentsInChildren<Graphic>(false).Select(g => new JObject
                    {
                        ["path"] = RelativePath(g.transform, root.transform),
                        ["depth"] = g.depth,
                        ["raycast"] = g.raycastTarget,
                        ["z"] = g.transform.position.z
                    }))
                };
                report["completed"] = true;
            }
            catch (Exception exception)
            {
                report["completed"] = false;
                report["error"] = exception.ToString();
            }
            finally
            {
                foreach (GameObject item in scene.GetRootGameObjects())
                {
                    foreach (BaseRaycaster raycaster in item.GetComponentsInChildren<BaseRaycaster>(true))
                    {
                        typeof(BaseRaycaster).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(raycaster, null);
                    }
                    foreach (EventSystem events in item.GetComponentsInChildren<EventSystem>(true))
                    {
                        typeof(EventSystem).GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(events, null);
                    }
                }
                if (previousEvents != null)
                {
                    EventSystem.current = previousEvents;
                }
                RenderTexture.active = previousTexture;
                EditorSceneManager.ClosePreviewScene(scene);
                if (texture != null)
                {
                    texture.Release();
                    UnityEngine.Object.DestroyImmediate(texture);
                }
                File.WriteAllText(Path.Combine(directory, "simulated-validation.json"), report.ToString());
            }
        }

        // Decorative backgrounds may bleed; visible text and actionable hit rectangles may not.
        private static JArray CheckSafeArea(GameObject root, Camera camera, Rect safe)
        {
            JArray results = new JArray();
            List<RectTransform> targets = root.GetComponentsInChildren<Text>(false)
                .Where(text => text.enabled && !string.IsNullOrEmpty(text.text))
                .Select(text => text.rectTransform).ToList();
            foreach (Button button in root.GetComponentsInChildren<Button>(false))
            {
                if (button.targetGraphic == null || !button.targetGraphic.isActiveAndEnabled)
                {
                    continue;
                }
                RectTransform hit = button.transform.Find("clickArea") as RectTransform;
                targets.Add(hit != null ? hit : button.targetGraphic.rectTransform);
            }
            foreach (RectTransform target in targets.Distinct())
            {
                Vector3[] corners = new Vector3[4];
                target.GetWorldCorners(corners);
                results.Add(new JObject
                {
                    ["path"] = RelativePath(target, root.transform),
                    ["inside"] = corners.All(corner => safe.Contains(camera.WorldToScreenPoint(corner)))
                });
            }
            return results;
        }

        private static Transform Resolve(GameObject root, string path)
        {
            return string.IsNullOrEmpty(path) ? root.transform : root.transform.Find(path);
        }

        private static void Advance(Animator animator)
        {
            animator.Update(0);
            for (int frame = 0; frame < 30; frame++)
            {
                animator.Update(1f / 60f);
            }
        }

        private static List<RaycastResult> Raycast(EventSystem events, Vector2 position)
        {
            List<RaycastResult> hits = new List<RaycastResult>();
            events.RaycastAll(new PointerEventData(events)
            {
                position = position
            }, hits);
            return hits;
        }

        private static string RelativePath(Transform target, Transform root)
        {
            return AnimationUtility.CalculateTransformPath(target, root);
        }

        private static void SaveImage(RenderTexture target, string path)
        {
            Texture2D pixels = new Texture2D(Width, Height, TextureFormat.RGBA32, false);
            try
            {
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(pixels);
            }
        }
    }
}
