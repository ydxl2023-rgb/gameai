using System.Collections.Generic;

namespace Oathx.Rpc
{
    /// <summary>
    /// net call method info
    /// </summary>
    public class XNetCallMethod
    {
        public string name;
        public int hash;
        public uint ping;
        public int send;
        public int recv;
        public uint call;
        public uint sendTime;
        public int sendByte;
        public uint recvTime;
        public int recvByte;
        public bool enabled;
        public long delay;
        public bool onlySend;
        public List<string> methodNames = new List<string>();
    }

    /// <summary>
    /// net call statistics
    /// </summary>
    public class XNetStatistics
    {
        private readonly Dictionary<string, XNetCallMethod> methods = new Dictionary<string, XNetCallMethod>();

        /// <summary>
        /// try get current net call method info
        /// </summary>
        /// <param name="name"></param>
        /// <param name="method"></param>
        /// <returns></returns>
        public bool TryGetNetMethod(string name, out XNetCallMethod method)
        {
            if (!methods.TryGetValue(name, out method))
            {
                method = new XNetCallMethod()
                {
                    name = name,
                    ping = 0,
                    send = 0,
                    recv = 0,
                    call = 0,
                    sendTime = 0,
                    sendByte = 0,
                    recvTime = 0,
                    recvByte = 0,
                    enabled = true
                };

                methods.Add(name, method);
            }

            return true;
        }
    }

    /// <summary>
    /// net analytics
    /// </summary>
    public class XNetAnalytics
{
        public static readonly Dictionary<XRpcType, XNetStatistics> statistics = new Dictionary<XRpcType, XNetStatistics>();

        /// <summary>
        /// try get net call method info
        /// </summary>
        /// <param name="rpcType"></param>
        /// <param name="name"></param>
        /// <param name="method"></param>
        /// <returns></returns>
        public static bool TryGetMethod(XRpcType rpcType, string name, out XNetCallMethod method)
        {
            if (!statistics.TryGetValue(rpcType, out var stat))
            {
                stat = new XNetStatistics();
                statistics.Add(rpcType, stat);
            }

            return stat.TryGetNetMethod(name, out method);
        }

        /// <summary>
        /// try get rpc statistics
        /// </summary>
        /// <param name="rpcType"></param>
        /// <param name="rpcStatistics"></param>
        /// <returns></returns>
        public static bool TryGetStatistics(XRpcType rpcType, out XNetStatistics rpcStatistics)
        {
            if (!statistics.TryGetValue(rpcType, out rpcStatistics))
            {
                rpcStatistics = new XNetStatistics();
                statistics.Add(rpcType, rpcStatistics);
            }

            return true;
        }
    }
}
