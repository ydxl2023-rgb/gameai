using System.Collections;
using System.Collections.Generic;
using UnityEditorInternal;
using UnityEditor;
using Oathx.Rpc;
using UnityEngine;

namespace Oathx.Rpc.Editor
{
    public enum XSessionType
    {
        Http = 0,
        Tcp = 1,
        Kcp = 2,
        Web = 4
    }

    [RpcFilePath("ProjectSettings/NetRpcSettings.asset")]
    public class XNetRpcSettings : RpcScriptableSingleton<XNetRpcSettings>
    {
        public string[] injectAssemblyNames;
        public bool outputDebugLog;
        public AssemblyDefinitionAsset[] assemblyDefinitionAssets;

        public XNetRpcSettings()
        {
            injectAssemblyNames = new string[] { "Assembly-CSharp" };
            outputDebugLog = true;
            assemblyDefinitionAssets = new AssemblyDefinitionAsset[] { };
        }
    }
};