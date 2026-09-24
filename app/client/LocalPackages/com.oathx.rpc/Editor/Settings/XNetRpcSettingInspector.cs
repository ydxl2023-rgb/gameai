using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using Oathx.Rpc;
using UnityEditor.Callbacks;
using System.IO;
using System;
using UnityEditorInternal;
using System.Linq;

namespace Oathx.Rpc.Editor
{
    public class RpcScriptableSingleton<T> : ScriptableObject where T : ScriptableObject
    {
        private static T _instance;

        /// <summary>
        /// 
        /// </summary>
        public static T Instance
        {
            get
            {
                if (!_instance)
                {
                    LoadOrCreate();
                }

                return _instance;
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public static T LoadOrCreate()
        {
            string filePath = GetFilePath();
            if (!string.IsNullOrEmpty(filePath))
            {
                var arr = InternalEditorUtility.LoadSerializedFileAndForget(filePath);
                if (arr.Length != 0)
                {
                    _instance = arr[0] as T;
                }
                else
                {
                    _instance = CreateInstance<T>();
                }
            }
            else
            {
                Debug.LogError($"save location of {nameof(ScriptableSingleton<T>)} is invalid");
            }

            return _instance;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="saveAsText"></param>
        public static void Save(bool saveAsText = true)
        {
            if (!_instance)
            {
                Debug.LogError("Cannot save ScriptableSingleton: no instance!");
                return;
            }

            string filePath = GetFilePath();
            if (!string.IsNullOrEmpty(filePath))
            {
                string directoryName = Path.GetDirectoryName(filePath);
                if (!Directory.Exists(directoryName))
                {
                    Directory.CreateDirectory(directoryName);
                }
                UnityEngine.Object[] obj = new T[1] { _instance };
                InternalEditorUtility.SaveToSerializedFileAndForget(obj, filePath, saveAsText);
            }
        }
        protected static string GetFilePath()
        {
            return typeof(T).GetCustomAttributes(inherit: true)
                .Where(v => v is RpcFilePathAttribute)
                .Cast<RpcFilePathAttribute>()
                .FirstOrDefault()
                ?.filepath;
        }
    }

    [AttributeUsage(AttributeTargets.Class)]
    public class RpcFilePathAttribute : Attribute
    {
        internal string filepath;

        public RpcFilePathAttribute(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("Invalid relative path (it is empty)");
            }
            if (path[0] == '/')
            {
                path = path.Substring(1);
            }
            filepath = path;
        }
    }

    public class XNetRpcSettingInspector : EditorWindow
    {
        private SerializedObject _serializedObject;
        private SerializedProperty _injectAssemblyNames;
        private SerializedProperty _outputDebugLog;
        private SerializedProperty _assemblyDefinitionAssets;

        [MenuItem("Rpc/Setting")]
        static void OpenEditor()
        {
            var window = GetWindow<XNetRpcSettingInspector>();
            window.titleContent = new GUIContent("Rpc Setting");
            window.Show();
        }

        private void OnEnable()
        {
            if (_serializedObject == null)
                InitGUI();
        }

        /// <summary>
        /// 
        /// </summary>
        private void OnGUI()
        {
            if (_serializedObject.targetObject)
            {
                _serializedObject.Update();

                EditorGUI.BeginChangeCheck();
                LayoutPropertyFields();

                if (EditorGUI.EndChangeCheck())
                {
                    _serializedObject.ApplyModifiedProperties();

                    // save rpc configure asset
                    XNetRpcSettings.Save();
                }
            }
        }

        private void InitGUI()
        {
            var setting = XNetRpcSettings.LoadOrCreate();
            if (setting.injectAssemblyNames == null)
            {
                setting.injectAssemblyNames = new string[] {
                    "Assembly-CSharp"
                };
            }

            _serializedObject?.Dispose();

            _serializedObject = new SerializedObject(setting);
            _injectAssemblyNames = _serializedObject.FindProperty("injectAssemblyNames");
            _outputDebugLog = _serializedObject.FindProperty("outputDebugLog");
            _assemblyDefinitionAssets = _serializedObject.FindProperty("assemblyDefinitionAssets");
        }

        /// <summary>
        /// 
        /// </summary>
        private void LayoutPropertyFields()
        {
            EditorGUILayout.PropertyField(_injectAssemblyNames);
            EditorGUILayout.PropertyField(_assemblyDefinitionAssets);
            EditorGUILayout.PropertyField(_outputDebugLog);
        }
    }
}
