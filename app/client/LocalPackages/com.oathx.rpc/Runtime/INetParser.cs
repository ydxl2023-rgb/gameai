using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// net parser
    /// </summary>
    public interface INetParser
    {
        /// <summary>
        /// serialize rpc call
        /// </summary>
        /// <param name="sessionType"></param>
        /// <param name="name"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        XNetPacket Serialize(XRpcType sessionType, int hash, params object[] args);

        /// <summary>
        /// deserialize rpc call
        /// </summary>
        /// <param name="packet"></param>
        /// <param name="rpcParams"></param>
        /// <returns></returns>
        object[] Deserialize(XNetPacket packet, System.Type[] rpcParams);
    }
}
