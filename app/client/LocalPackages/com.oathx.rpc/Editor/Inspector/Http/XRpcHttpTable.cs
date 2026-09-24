using UnityEngine;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public class XRpcHttpTable : XRpcTable
    {
        /// <summary>
        /// 
        /// </summary>
        public XRpcHttpTable()
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
                if (XNetAnalytics.TryGetStatistics(XRpcType.Http, out var statistics))
                {
                    UpdateTrackMethod(statistics, _rpcTrack.methods);
                }
            }
        }

        /// <summary>
        /// 
        /// </summary>
        public override void SessionBar(Rect rect)
        {
            GUILayout.BeginArea(rect, new GUIStyle(GUI.skin.box));
            
            if (XNetRpc.TryGetSession(XRpcType.Http, out var session))
            {
                GUI.color = Color.green;
                GUILayout.Label(session.ToString());
                GUI.color = Color.white;
            }

            GUILayout.EndArea();
        }
    }
}

