using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using Oathx.Rpc;
using UnityEditor.Callbacks;
using System.IO;
using System.Reflection;
using System;
using System.Linq;

namespace Oathx.Rpc.Editor
{
    interface XRpcTrackTable
    {
        /// <summary>
        /// 
        /// </summary>
        /// <param name="rect"></param>
        void OnEnable(Rect rect);

        /// <summary>
        /// 
        /// </summary>
        void OnDisable();

        /// <summary>
        /// 
        /// </summary>
        /// <param name="rect"></param>
        void OnGUI(Rect rect);

        /// <summary>
        /// 
        /// </summary>
        void OnReload();

        /// <summary>
        /// 
        /// </summary>
        /// <param name="asset"></param>
        void OnOpened(XRpcTrackInfo track);

        /// <summary>
        /// 
        /// </summary>
        void OnUpdate();
    }

    public class XRpcInspectorWindow : EditorWindow
    {
        [MenuItem("Rpc/Track")]
        static void OpenEditor()
        {
            XRpcInspectorWindow window = GetWindow<XRpcInspectorWindow>();
            window.titleContent = new GUIContent("Rpc");
            window.Show();
        }

        /// <summary>
        /// rpc configrue
        /// </summary>
        private int _rpcSessionIndex = 0;

        /// <summary>
        /// 
        /// </summary>
        private readonly Dictionary<XRpcType, XRpcTrackTable> 
            _rpcTabs = new Dictionary<XRpcType, XRpcTrackTable>();
        
        /// <summary>
        /// 
        /// </summary>
        private readonly List<string> _rpcNames = new List<string>();
        /// <summary>
        /// 
        /// </summary>
        private readonly List<XRpcType> _rpcTypes = new List<XRpcType>();

        /// <summary>
        /// 
        /// </summary>
        private XRpcTrackLog _rpcTrack = new XRpcTrackLog();

        /// <summary>
        /// 
        /// </summary>
        public XRpcInspectorWindow()
        {
            _rpcTabs.Add(XRpcType.Http, new XRpcHttpTable());
            _rpcTabs.Add(XRpcType.Tcp, new XRpcTcpTable());
            _rpcTabs.Add(XRpcType.Web, new XRpcWebTable());
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        private Rect GetSubWindowArea()
        {
            return new Rect(0, 0, position.width, position.height);
        }

        /// <summary>
        /// 
        /// </summary>
        private void OnEnable()
        {
            minSize = new Vector2(500, 320);
            CollectAllRpcMethods();
        }

        /// <summary>
        /// 
        /// </summary>
        private void OnDisable()
        {
            foreach (KeyValuePair<XRpcType, XRpcTrackTable> v in _rpcTabs)
            {
                v.Value.OnDisable();
            }
        }

        /// <summary>
        /// 
        /// </summary>
        private void OnGUI()
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                _rpcSessionIndex = GUILayout.Toolbar(_rpcSessionIndex, _rpcNames.ToArray());
                if (GUILayout.Button("刷新", GUILayout.Width(50)))
                {
                    CollectAllRpcMethods();
                }

                if (GUILayout.Button("设置", GUILayout.Width(50)))
                {
                    EditorApplication.ExecuteMenuItem("Rpc/Setting");
                }
            }

            if (_rpcSessionIndex < 0 || _rpcSessionIndex >= _rpcTypes.Count)
            {
                return;
            }

            XRpcType type = _rpcTypes[_rpcSessionIndex];
            bool empty = _rpcTrack.TryGetRpcTrackInfo(type, out var track) && track.methods.Count <= 1;
            float messageHeight = empty || !string.IsNullOrEmpty(scanMessage) ? 60 : 0;
            if (messageHeight > 0)
            {
                string message = string.IsNullOrEmpty(scanMessage)
                    ? "未发现 " + type + " RPC 方法。请在 Rpc/Setting 中配置业务程序集，并添加带 RpcClientCallServer 特性的公开方法，然后点击刷新。"
                    : scanMessage;
                EditorGUI.HelpBox(new Rect(10, 26, Mathf.Max(0, position.width - 20), 54), message, MessageType.Info);
            }

            // Reserve message space instead of covering any collected method rows.
            Rect content = new Rect(0, messageHeight, position.width, Mathf.Max(180, position.height - messageHeight));
            GUI.BeginGroup(content);
            if (_rpcTabs.TryGetValue(type, out var tab))
            {
                tab.OnGUI(new Rect(0, 0, content.width, content.height));
            }
            GUI.EndGroup();
        }

        private string scanMessage;

        private int fps = 0;
        
        /// <summary>
        /// 
        /// </summary>
        private void Update()
        {
            if (_rpcSessionIndex >= 0 && _rpcSessionIndex < _rpcTypes.Count)
            {
                if (_rpcTabs.TryGetValue(_rpcTypes[_rpcSessionIndex], out var tab))
                    tab.OnUpdate();
            }
         
            fps++;
            if (fps >= 10)
            {
                Repaint();
                fps = 0;
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="assemblys"></param>
        /// <returns></returns>
        public bool TryGetAssemblys(out List<Assembly> assemblys)
        {
            assemblys = new List<Assembly>();
            scanMessage = null;
            Assembly[] loaded = AppDomain.CurrentDomain.GetAssemblies();
            var settings = XNetRpcSettings.Instance;
            HashSet<string> names = new HashSet<string>(StringComparer.Ordinal);
            foreach (string name in settings.injectAssemblyNames ?? Array.Empty<string>())
            {
                if (!string.IsNullOrWhiteSpace(name))
                {
                    names.Add(name.Trim());
                }
            }

            foreach (var definition in settings.assemblyDefinitionAssets ?? Array.Empty<UnityEditorInternal.AssemblyDefinitionAsset>())
            {
                if (definition == null)
                {
                    continue;
                }

                // An asmdef file name can differ from its declared assembly name.
                try
                {
                    AssemblyDefinition data = JsonUtility.FromJson<AssemblyDefinition>(definition.text);
                    if (data != null && !string.IsNullOrWhiteSpace(data.name))
                    {
                        names.Add(data.name.Trim());
                    }
                }
                catch (ArgumentException)
                {
                    scanMessage = "部分程序集定义无法读取，请检查 Rpc/Setting。";
                }
            }

            List<string> missing = new List<string>();
            foreach (string name in names)
            {
                Assembly assembly = loaded.FirstOrDefault(item => item.GetName().Name == name);
                if (assembly == null)
                {
                    missing.Add(name);
                }
                else
                {
                    assemblys.Add(assembly);
                }
            }

            if (missing.Count > 0)
            {
                scanMessage = "未加载程序集：" + string.Join("、", missing) + "。请检查 Rpc/Setting 和编译错误，然后刷新。";
            }
            else if (names.Count == 0)
            {
                scanMessage = "尚未配置扫描程序集，请打开 Rpc/Setting 设置程序集名称或程序集定义。";
            }

            return assemblys.Count > 0;
        }

        [Serializable]
        private sealed class AssemblyDefinition
        {
            public string name;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="assembly"></param>
        private void CollectMethods(Assembly assembly)
        {
            HashSet<XRpcType> types = new HashSet<XRpcType>();
            foreach (var type in assembly.GetTypes())
            {
                foreach (var method in type.GetMethods())
                {
                    var clientCallServer = method.GetCustomAttribute<RpcClientCallServer>();
                    if (clientCallServer != null)
                    {
                        int hash = clientCallServer.HashCode;
                        if (hash == 0)
                            hash = XNetUtility.HashString(method.Name);

                        if (_rpcTrack.TryAddMethod(clientCallServer.SessionType, method.Name, hash, 0, out var trackInfo))
                        {
                            if (!types.Contains(clientCallServer.SessionType))
                                types.Add(clientCallServer.SessionType);
                        }
                    }
                }
            }

            var names = Enum.GetNames(typeof(RpcInternal));
            foreach (var name in names)
            {
                foreach (var type in types)
                {
                    _rpcTrack.TryAddMethod(type, name, XNetUtility.HashString(name), 1, out var trackInfo);
                }
            }

            foreach (var type in assembly.GetTypes())
            {
                foreach (var method in type.GetMethods())
                {
                    var serverCallClient = method.GetCustomAttribute<RpcServerCallClient>();
                    if (serverCallClient != null)
                    {
                        if (_rpcTrack.TryGetRpcTrackInfo(serverCallClient.sessionType, out var trackInfo))
                        {
                            if (trackInfo.TryGetMethod(method.Name, out var editorMethod))
                            {
                                editorMethod.serverMethods.Add($"{method.DeclaringType.Name}.{method.Name}");
                            }
                        }
                    }
                }
            }
        }
    
        /// <summary>
        /// 
        /// </summary>
        /// <param name="assembly"></param>
        /// <param name="rpcType"></param>
        /// <param name="name"></param>
        /// <param name="methods"></param>
        /// <returns></returns>
        private bool TryCollectServerMethods(Assembly assembly, XRpcType rpcType, string name, out List<MethodInfo> methods)
        {
            methods = new List<MethodInfo>();
            foreach(var type in assembly.GetTypes())
            {
                foreach(var method in type.GetMethods())
                {
                    var serverCallClient = method.GetCustomAttribute<RpcServerCallClient>();
                    if (serverCallClient != null && method.Name == name)
                    {
                        methods.Add(method);
                    }
                }
            }

            return methods.Count > 0;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public bool CollectAllRpcMethods()
        {
            // Every supported protocol owns a root even when no business methods exist.
            _rpcTrack.tracks.Clear();
            _rpcNames.Clear();
            _rpcTypes.Clear();
            foreach (XRpcType type in new[]
            {
                XRpcType.Http,
                XRpcType.Tcp,
                XRpcType.Web
            })
            {
                _rpcTrack.tracks.Add(new XRpcTrackInfo(type));
                _rpcTypes.Add(type);
                _rpcNames.Add(type.ToString());
            }

            bool found = TryGetAssemblys(out var assemblies);
            foreach (Assembly assembly in assemblies)
            {
                try
                {
                    CollectMethods(assembly);
                }
                catch (ReflectionTypeLoadException)
                {
                    scanMessage = "程序集 " + assembly.GetName().Name + " 的部分类型无法加载，请检查依赖和编译错误。";
                }
            }

            foreach (XRpcTrackInfo track in _rpcTrack.tracks)
            {
                if (_rpcTabs.TryGetValue(track.rpcType, out var table))
                {
                    table.OnOpened(track);
                    table.OnEnable(GetSubWindowArea());
                }
            }

            _rpcSessionIndex = Mathf.Clamp(_rpcSessionIndex, 0, _rpcTypes.Count - 1);
            Repaint();
            return found;
        }
    }
}
