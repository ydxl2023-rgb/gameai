using System.Collections.Generic;
using UnityEngine;
using Oathx.Rpc;
using System.Text;
using UnityEditor;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public class XRpcTcpTable : XRpcTable
    {
        /// <summary>
        /// 
        /// </summary>
        public XRpcTcpTable()
            :base()
        {

        }

        /// <summary>
        /// 
        /// </summary>
        public override void OnUpdate()
        {
            if (_rpcTrack != null)
            {
                if (XNetAnalytics.TryGetStatistics(XRpcType.Tcp, out var statistics))
                {
                    UpdateTrackMethod(statistics, _rpcTrack.methods);
                }
            }
        }

        public enum ConnectStatus
        {
            Connect,
            Disconnect,
            Timeout
        }

        /// <summary>
        /// 
        /// </summary>
        public override void SessionBar(Rect rect)
        {
            GUILayout.BeginArea(rect, new GUIStyle(GUI.skin.box));
            
            if (XNetRpc.TryGetSession(XRpcType.Tcp, out var session))
            {
                GUILayout.Label($"Type: <{session.Type}>");
                GUILayout.Label($"Addr: <{session.Addr}:{session.Port}>");
                GUILayout.Label($"Host: <{session.Host}>");

                Color old = GUI.color;

                GUI.color = session.Connected() ? Color.green : Color.red;
                GUILayout.Label($"Connect:{session.Connected()}");
                GUI.color = old;
            }
            GUILayout.EndArea();
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="rect"></param>
        public override void BottomToolbar(Rect rect)
        {
            GUILayout.BeginArea(rect);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Disconnect"))
                {
                    if (XNetRpc.TryGetSession(XRpcType.Tcp, out var session))
                    {
                        session.Disconnect();
                    }
                }

                if (GUILayout.Button("Reconnect"))
                {
                    if (XNetRpc.TryGetSession(XRpcType.Tcp, out var session))
                    {
                        XNetRpc.DestroyServer(XRpcType.Tcp);

                        var server = new XRpcServerInfo()
                        {
                            addr = session.Addr,
                            port = session.Port,
                            host = session.Host,
                            type = session.Type
                        };
                        XNetRpc.TryCreateServer(server, out var tcp);
                    }
                }
            }

            GUILayout.EndArea();
        }
    }
}

