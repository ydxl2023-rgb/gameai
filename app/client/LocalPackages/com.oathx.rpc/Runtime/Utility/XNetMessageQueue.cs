using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// net message queue
    /// </summary>
    public static class XNetMessageQueue 
    {
        private static readonly Queue<XNetPacket> recvQueue = new Queue<XNetPacket>();
        private static readonly Queue<XNetPacket> sendQueue = new Queue<XNetPacket>();

        /// <summary>
        /// send queue
        /// </summary>
        /// <param name="packet"></param>
        public static void SendPacket(XNetPacket packet)
        {
            packet.Finish();

            lock (sendQueue)
            {
                sendQueue.Enqueue(packet);

#if UNITY_EDITOR
                Debug.Log($"Tcp Send queue current count {sendQueue.Count}");
#endif
            }
        }

        /// <summary>
        /// post recv packet
        /// </summary>
        /// <param name="packet"></param>
        public static void PostPacket(XNetPacket packet)
        {
            packet.Finish();

            lock (recvQueue)
            {
                recvQueue.Enqueue(packet);

#if UNITY_EDITOR || UNITY_DEVELOP
                Debug.Log($"Net message queue add type {packet.Type} size {packet.Size} Enqueue queue {recvQueue.Count}");
#endif
            }
        }

        /// <summary>
        /// get recv queue
        /// </summary>
        /// <returns></returns>
        public static Queue<XNetPacket> GetRecvQueue()
        {
            return recvQueue;
        }

        /// <summary>
        /// get send queue
        /// </summary>
        /// <returns></returns>
        public static Queue<XNetPacket> GetSendQueue()
        {
            return sendQueue;
        }

        /// <summary>
        /// clear queues
        /// </summary>
        public static void Clear()
        {
            lock(recvQueue)
            {
                recvQueue.Clear();
            }

            lock (sendQueue)
            {
                sendQueue.Clear();
            }
        }
    }
}
