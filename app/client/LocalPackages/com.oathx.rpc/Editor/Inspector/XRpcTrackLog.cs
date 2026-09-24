using System.Collections.Generic;
using UnityEngine;
using Oathx.Rpc;
using System.IO;

namespace Oathx.Rpc.Editor
{
    [System.Serializable]
    public class XRpcTrackInfo
    {
        /// <summary>
        /// 根节点
        /// </summary>
        [System.NonSerialized]
        private XRpcEditorMethod root;

        /// <summary>
        /// 追踪类型
        /// </summary>
        [SerializeField]
        public XRpcType rpcType;

        /// <summary>
        /// 会话方法
        /// </summary>
        [SerializeField]
        public List<XRpcEditorMethod> 
            methods = new List<XRpcEditorMethod>();

        /// <summary>
        /// 
        /// </summary>
        /// <param name="type"></param>
        public XRpcTrackInfo(XRpcType type)
        {
            Init(type);
        }

        /// <summary>
        /// 初始化
        /// </summary>
        /// <param name="type"></param>
        public void Init(XRpcType type)
        {
            rpcType = type;

            root = new XRpcEditorMethod("root", -1, 0);
            if (root != null)
                methods.Add(root);
        }

        /// <summary>
        /// 重置方法
        /// </summary>
        public void Reset()
        {
            if (methods.Count != 0)
                methods.Clear();

            root = new XRpcEditorMethod("root", -1, 0);
            if (root != null)
                methods.Add(root);
        }

        /// <summary>
        /// 添加方法
        /// </summary>
        /// <param name="type"></param>
        /// <param name="hash"></param>
        /// <param name="name"></param>
        /// <param name="flag"></param>
        public void Add(XRpcType type, int hash, string name, int flag)
        {
            var index = methods.FindIndex(v => v.name == name);
            if (index < 0)
            {
                methods.Add(new XRpcEditorMethod(name, root.depth + 1, hash)
                {
                    hash = hash,
                    type = type,
                    flag = flag
                });
            }
        }

        public void Add(XRpcType type, int hash, string name, string displayName)
        {
            var index = methods.FindIndex(v => v.name == name);
            
                methods.Add(new XRpcEditorMethod(name, root.depth + 2, hash)
                {
                    displayName = displayName,
                    hash = hash,
                    type = type,
                    flag = 1
                }) ;
            
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <param name="method"></param>
        /// <returns></returns>
        public bool TryGetMethod(string name, out XRpcEditorMethod method)
        {
            method = methods.Find((v) => v.name == name);
            if (method == null)
                return false;

            return true;
        }
    }

    [System.Serializable]
    public class XRpcTrackLog
    {
        public List<XRpcTrackInfo> tracks = new List<XRpcTrackInfo>();

        /// <summary>
        /// 
        /// </summary>
        /// <param name="type"></param>
        /// <param name="name"></param>
        /// <param name="hash"></param>
        /// <param name="flag"></param>
        public bool TryAddMethod(XRpcType type, string name, int hash, int flag, out XRpcTrackInfo trackInfo)
        {
            trackInfo = tracks.Find(v => { return v.rpcType == type; });
            if (trackInfo == null)
            {
                trackInfo = new XRpcTrackInfo(type);
                tracks.Add(trackInfo);
            }
                
            var index = trackInfo.methods.FindIndex(v => v.name == name);
            if (index < 0)
            {
                trackInfo.Add(type, hash, name, flag);
                return true;
            }

            return false;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="rpcType"></param>
        /// <param name="track"></param>
        /// <returns></returns>
        public bool TryGetRpcTrackInfo(XRpcType rpcType, out XRpcTrackInfo track)
        {
            track = tracks.Find((v) => v.rpcType == rpcType);
            if (track == null)
                return false;

            return true;
        }
    }
}
