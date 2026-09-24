using System.Collections.Generic;
using UnityEngine;
using Oathx.Rpc;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public class XRpcWebTable : XRpcTable
    {
        /// <summary>
        /// 
        /// </summary>
        public XRpcWebTable()
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
                if (XNetAnalytics.TryGetStatistics(XRpcType.Web, out var statistics))
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
            GUILayout.BeginArea(rect);
            GUILayout.EndArea();

        }
    }
}

