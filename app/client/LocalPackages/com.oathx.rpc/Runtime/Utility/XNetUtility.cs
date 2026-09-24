using System;
using System.Collections.Generic;

namespace Oathx.Rpc
{
    /// <summary>
    /// net wait utility
    /// </summary>
    public static class XNetWait
    {
#pragma warning disable IDE0090
        private static readonly Dictionary<int, List<Action>>
            actions = new Dictionary<int, List<Action>>();

#if UNITY_EDITOR
        /// <summary>
        /// pending actions
        /// </summary>
        private static readonly Dictionary<int, uint> pendings = new Dictionary<int, uint>();
#endif
        /// <summary>
        /// add wait action
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="complete"></param>
        public static void Add(int hash, Action complete)
        {
            if (!actions.TryGetValue(hash, out var callbacks))
            {
                callbacks = new List<Action>();
                actions.Add(hash, callbacks);
            }

            callbacks.Add(complete);

#if UNITY_EDITOR
            var iclock = XNetUtility.Iclock();
            if (pendings.ContainsKey(hash))
            {
                pendings[hash] = iclock;
            }
            else
            {
                pendings.Add(hash, iclock);
            }
#endif
        }

        /// <summary>
        /// wait done
        /// </summary>
        /// <param name="hash"></param>
        public static bool Done(int hash)
        {
            if (!actions.TryGetValue(hash, out var callbacks))
                return false;
            
            foreach (var done in callbacks)
            {
                done?.Invoke();
            }

            callbacks.Clear();
            
            return true;
        }
#pragma warning restore IDE0090
    }


    public sealed class XNetUtility
    {
        private static readonly DateTime utcTime = new DateTime(1970, 1, 1);
        
        /// <summary>
        /// 
        /// </summary>
        private static INetParser parser;

        /// <summary>
        /// 
        /// </summary>
        /// <param name="netParser"></param>
        public static void SetParser(INetParser netParser)
        {
            parser = netParser;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public static INetParser GetParser()
        {
            return parser;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public static uint Iclock()
        {
            return (uint)(Convert.ToInt64(DateTime.UtcNow.Subtract(utcTime).TotalMilliseconds) & 0xffffffff);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="str"></param>
        /// <returns></returns>
        public static int HashString(string str)
        {
            const uint InitialFNV = 2166136261U;
            const uint FNVMultiple = 16777619;

            uint hash = InitialFNV;
            for (int i = 0; i < str.Length; i++)
            {
                hash ^= str[i];
                hash *= FNVMultiple;
            }

            return (int)(hash & 0x7FFFFFFF);
        }

        /// <summary>
        /// make rpc packet
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        public static XNetPacket Serialize(XRpcType sessionType, int hash, params object[] args)
        {
            return parser.Serialize(sessionType, hash, args);
        }

        /// <summary>
        /// make rpc packket
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        public static XNetPacket Serialize(XRpcType sessionType, string name, params object[] args)
        {
            return Serialize(sessionType, HashString(name), args);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="packet"></param>
        /// <returns></returns>
        public static object[] Deserialize(XNetPacket packet, Type[] rpcParams)
        {
            return parser.Deserialize(packet, rpcParams);
        }
    }
}