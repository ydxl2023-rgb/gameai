using System.Collections.Generic;
using System;
using System.Reflection;
using UnityEngine;
using System.Collections;

namespace Oathx.Rpc
{
    /// <summary>
    /// internal class, rpc call method info
    /// </summary>
    public class XRpcMethod
    {
        /// <summary>
        /// rpc method owner
        /// </summary>
        private object      rpcSender;

        /// <summary>
        /// rpc method info
        /// </summary>
        private MethodInfo  rpcMethod;

#if UNITY_EDITOR
        public uint time;
        public uint call;
#endif
        /// <summary>
        /// construct rpc call method
        /// </summary>
        /// <param name="sender">caller</param>
        /// <param name="methodInfo">method info</param>
        public XRpcMethod(object sender, MethodInfo methodInfo)
        {
            rpcSender = sender; rpcMethod = methodInfo;
        }

        /// <summary>
        /// rpc call
        /// </summary>
        /// <param name="args"></param>
        public void Invoke(params object[] args)
        {
#if UNITY_EDITOR
            time = XNetUtility.Iclock();
#endif
            rpcMethod.Invoke(rpcSender, args);

#if UNITY_EDITOR
            call = XNetUtility.Iclock() - time;
#endif
        }

        /// <summary>
        /// get rpc method owner
        /// </summary>
        public object Sender
        {
            get { return rpcSender; }
        }
    }

    /// <summary>
    /// rpc client method
    /// </summary>
    public class XRpcClientMethod
    {
        /// <summary>
        /// all rpc methods
        /// </summary>
        private List<XRpcMethod>
            methods = new List<XRpcMethod>();

        /// <summary>
        /// rpc method params
        /// </summary>
        private Type[] rpcParams;
        /// <summary>
        /// rpc method name
        /// </summary>
        private string rpcName;

        /// <summary>
        /// construct rpc function, parse function params
        /// </summary>
        /// <param name="methodInfo"></param>
        public XRpcClientMethod(MethodInfo methodInfo)
        {
            ParameterInfo[] parameterInfoList = methodInfo.GetParameters();
            if (parameterInfoList.Length > 0)
            {
                rpcParams = new Type[parameterInfoList.Length];
                for (int i = 0; i < rpcParams.Length; i++)
                {
                    rpcParams[i] = parameterInfoList[i].ParameterType;
                }
            }

            rpcName = methodInfo.Name;
        }

        /// <summary>
        /// 
        /// </summary>
        public string Name => rpcName;

        /// <summary>
        /// add new rpc method to rpc call
        /// </summary>
        /// <param name="rpcMethod"></param>
        public void AddMethod(XRpcMethod rpcMethod)
        {
            methods.Add(rpcMethod);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="senderName"></param>
        /// <param name="method"></param>
        /// <returns></returns>
        public XRpcMethod GetMethod(string senderName)
        {
            return methods.Find((v) => v.Sender.GetType().Name.Equals(senderName));
        }

        /// <summary>
        /// remove rpc method
        /// </summary>
        /// <param name="sender"></param>
        public void RemoveMethod(object sender)
        {
            List<int> removes = new List<int>();
            for (int index = 0; index < methods.Count; index++)
            {
                if (methods[index].Sender == sender)
                {
                    removes.Add(index);
                }
            }

            for (int i = removes.Count - 1; i >= 0; i--)
            {
                methods.RemoveAt(removes[i]);
            }
        }

        /// <summary>
        /// execute rpc call
        /// </summary>
        /// <param name="args"></param>
        public void DoCall(params object[] args)
        {
            for (int index = 0; index < methods.Count; index++)
            {
                var method = methods[index];
                method.Invoke(args);
            }
        }

        /// <summary>
        /// execute rpc call
        /// </summary>
        /// <param name="args"></param>
        public void Invoke(params object[] args)
        {
            DoCall(args);
        }

        /// <summary>
        /// parse net packet params
        /// </summary>
        /// <param name="packet"></param>
        public void Invoke(XNetPacket packet)
        {
            var args = XNetUtility.Deserialize(packet, rpcParams);
            DoCall(args);
        }
    }

    /// <summary>
    /// server method info
    /// </summary>
    public class XRpcServerMethod
    {
        private MethodInfo rpcMethod;

        private Type[] rpcParams;
        private object rpcSender;

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="method"></param>
        public XRpcServerMethod(object sender, MethodInfo method)
        {
            rpcSender = sender;
            rpcMethod = method;

            ParameterInfo[] parameterInfoList = method.GetParameters();
            if (parameterInfoList.Length > 0)
            {
                rpcParams = new Type[parameterInfoList.Length];
                for (int i = 0; i < rpcParams.Length; i++)
                {
                    rpcParams[i] = parameterInfoList[i].ParameterType;
                }
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="args"></param>
        public void Invoke(params object[] args)
        {
            rpcMethod.Invoke(rpcSender, args);
        }
    }

    /// <summary>
    /// 
    /// </summary>
    public partial class XNetRpc
    {
#pragma warning disable IDE0090
        /// <summary>
        /// all server method info
        /// </summary>
        private static readonly Dictionary<int, XRpcClientMethod> serverCallClientProtocol = new Dictionary<int, XRpcClientMethod>();

        /// <summary>
        /// all client method info
        /// </summary>
        private static readonly Dictionary<int, XRpcServerMethod> clientCallServerProtocol = new Dictionary<int, XRpcServerMethod>();

        /// <summary>
        /// register server protocol
        /// </summary>
        /// <param name="sender"></param>
        public static void RegisterProtocol(object sender)
        {
#if UNITY_EDITOR
            NetLog($"RegisterProtocol {sender.GetType().Name}");
#endif
            MethodInfo[] methodInfoList = sender.GetType().GetMethods();

            RegisterClientCallServerMethod(sender, methodInfoList);
            RegisterServerCallClientMethod(sender, methodInfoList);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="methodInfoList"></param>
        private static void RegisterClientCallServerMethod(object sender, MethodInfo[] methodInfoList)
        {
            foreach (MethodInfo methodInfo in methodInfoList)
            {
                RpcClientCallServer clientCallServer = methodInfo.GetCustomAttribute<RpcClientCallServer>();
                if (clientCallServer != null)
                {
                    int hash = clientCallServer.HashCode;
                    if (hash == 0)
                        hash = XNetUtility.HashString(methodInfo.Name);

                    if (protocolHashMap.ContainsKey(hash))
                        throw new NotSupportedException($"The Rpc function {methodInfo.Name} has encountered a HASH collision, which is not allowed. Please change the function name");

                    protocolHashMap[hash] = methodInfo.Name;
                    protocolNameMap[methodInfo.Name] = hash;

                    // register client call server method
                    if (!clientCallServerProtocol.TryGetValue(hash, out var rpcServerMethod))
                    {
                        rpcServerMethod = new XRpcServerMethod(sender, methodInfo);
                        clientCallServerProtocol.Add(hash, rpcServerMethod);
                    }

#if UNITY_EDITOR || !UNITY_RELEASE
                    NetLog($"Register {sender.GetType().Name} {clientCallServer.GetRpcSessionType()} call server method <color=red>{methodInfo.Name}[{hash}]</color>");
#endif
                }
            }
        }

        /// <summary>
        /// generate client protocol method
        /// </summary>
        /// <param name="sender"></param>
        private static void RegisterServerCallClientMethod(object sender, MethodInfo[] methodInfoList)
        {
            foreach (MethodInfo methodInfo in methodInfoList)
            {
                RpcServerCallClient rpcClient = methodInfo.GetCustomAttribute<RpcServerCallClient>();
                if (rpcClient != null)
                {
                    int hash = GetProtocolHashByMethodName(methodInfo.Name);
                    if (!serverCallClientProtocol.TryGetValue(hash, out var rpcClientMethod))
                    {
                        rpcClientMethod = new XRpcClientMethod(methodInfo);

                        // add tcp or kcp method handle
                        serverCallClientProtocol.Add(hash, rpcClientMethod);
                    }

#if UNITY_EDITOR
                    NetLog($"Register {sender.GetType().Name} {rpcClient.sessionType} server call client method <color=red>{methodInfo.Name}[{hash}]</color>");
#endif
                    rpcClientMethod.AddMethod(new XRpcMethod(sender, methodInfo));
                }
            }
        }

        /// <summary>
        /// remove rpc protocol method
        /// </summary>
        /// <param name="sender"></param>
        public static void UnregisterProtocol(object sender)
        {
#if UNITY_EDITOR
            NetLog($"UnregisterProtocol {sender.GetType().Name}");
#endif
            Type protocolClassType = sender.GetType();

            MethodInfo[] methodInfoList = protocolClassType.GetMethods();
            foreach (MethodInfo methodInfo in methodInfoList)
            {
                RpcServerCallClient rpcServer = methodInfo.GetCustomAttribute<RpcServerCallClient>();
                if (rpcServer != null)
                {
                    int hash = GetProtocolHashByMethodName(methodInfo.Name);
                    XRpcClientMethod rpc = serverCallClientProtocol[hash];
                    if (rpc != null)
                    {
#if UNITY_EDITOR
                        NetLog($"Rpc remove server call client procotol {hash}={methodInfo.Name}");
#endif
                        rpc.RemoveMethod(sender);
                    }
                }
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        public static bool CallLocal(XRpcType sessionType, string name, params object[] args)
        {
            var packet = XNetUtility.Serialize(sessionType, XNetUtility.HashString(name), args);
            XNetMessageQueue.PostPacket(packet);

            return true;
        }

        /// <summary>
        /// server call client method
        /// </summary>
        /// <param name="packet"></param>
        /// <returns></returns>
        public static bool ServerCallClientMethod(XNetPacket packet)
        {
            int packetType = packet.Type;

            #region EDITOR
#if UNITY_EDITOR
            XRpcType sessionType = (XRpcType)packet.Flags;
            if (!serverCallClientProtocol.ContainsKey(packetType))
            {
                NetLogWarning($"Server call client method, an unimplemented {sessionType} protocol {packetType} RealSize {packet.RealSize}");
                return false;
            }

            string protoclName = GetProtocolNameByHash(packetType);
            
            // recv server result time
            uint recvAt = XNetUtility.Iclock();
            if (!XNetAnalytics.TryGetMethod(sessionType, protoclName, out var method))
                return false;

            if (!method.enabled || method.onlySend)
                return false;

            if (method.delay > 0)
            {
                XNetCoroutine.Run(DoRecvPacket(method.delay, ()=> {
                    recvAt = XNetUtility.Iclock();

                    // delay over, resume rpc method call
                    RecvPacket(packetType, packet, method);

                    // update track info
                    method.recvByte += packet.RealSize;
                    method.recv++;
                    method.recvTime = recvAt;
                    
                    // calc rpc server method call time
                    method.call = XNetUtility.Iclock() - recvAt;
                }));

                return true;
            }
            else
            {
                // update track info
                method.recvByte += packet.RealSize;
                method.recv++;
                method.recvTime = recvAt;
            }
#endif
            #endregion

            // in release env, execute rpc server method
            RecvPacket(packetType, packet);

            #region EDITOR
#if UNITY_EDITOR
            method.call = XNetUtility.Iclock() - recvAt;
#endif
            #endregion

            return true;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="packetType"></param>
        /// <param name="packet"></param>
        static bool RecvPacket(int packetType, XNetPacket packet, XNetCallMethod method=null)
        {
            XRpcClientMethod rpc = serverCallClientProtocol[packetType];
            rpc.Invoke(packet);

            return XNetWait.Done(packetType);
        }

#if UNITY_EDITOR
        /// <summary>
        /// 
        /// </summary>
        /// <param name="delay"></param>
        /// <param name="packetType"></param>
        /// <param name="packet"></param>
        /// <returns></returns>
        static IEnumerator DoRecvPacket(long delay, Action complete)
        {
            yield return new WaitForSeconds(delay * 0.001f);
            
            complete?.Invoke();
        }
#endif

        /// <summary>
        /// protocol hash map
        /// </summary>
        private static readonly Dictionary<string, int> protocolNameMap = new Dictionary<string, int>();
        private static readonly Dictionary<int, string> protocolHashMap = new Dictionary<int, string>();

        /// <summary>
        /// get protocol hash ID
        /// </summary>
        /// <param name="methodName"></param>
        /// <returns></returns>
        private static int GetProtocolHashByMethodName(string methodName)
        {
#if UNITY_EDITOR
            if (!protocolNameMap.ContainsKey(methodName))
                NetLogError($"An RPC protocol {methodName} is not defined");            
#endif

            return protocolNameMap[methodName];
        }

        /// <summary>
        /// get protocol hash ID
        /// </summary>
        /// <param name="methodEnum"></param>
        /// <returns></returns>
        private static int GetProtocolHashByMethod(string methodName)
        {
#if UNITY_EDITOR
            if (!protocolNameMap.ContainsKey(methodName))
            {
                NetLogError($"An RPC protocol [{methodName}] is not defined");
            }
#endif

            return protocolNameMap[methodName];
        }

        /// <summary>
        /// get protocol name
        /// </summary>
        /// <param name="hash"></param>
        /// <returns></returns>
        public static string GetProtocolNameByHash(int hash)
        {
            if (!protocolHashMap.ContainsKey(hash))
                return hash.ToString();

            return protocolHashMap[hash];
        }

        /// <summary>
        /// out put normal log
        /// </summary>
        /// <param name="message"></param>
        private static void NetLog(object message)
        {
            Debug.Log($"[{Time.frameCount}] <color=yellow>{message}</color>");
        }

        /// <summary>
        /// out put error log
        /// </summary>
        /// <param name="message"></param>
        private static void NetLogError(object message)
        {
            Debug.LogError($"[{Time.frameCount}] {message}");
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="message"></param>
        private static void NetLogWarning(object message)
        {
            Debug.LogWarning($"[{Time.frameCount}] {message}");
        }

        /// <summary>
        /// current active sessions
        /// </summary>
        private static readonly Dictionary<XRpcType, XNetSession> sessions = new Dictionary<XRpcType, XNetSession>();

        /// <summary>
        /// session factorys
        /// </summary>
        private static readonly Dictionary<XRpcType, XNetSessionFactory>
            factorys = new Dictionary<XRpcType, XNetSessionFactory>();

        /// <summary>
        /// startup rpc
        /// </summary>
        /// <param name="serverConfig"></param>
        /// <returns></returns>
        public static bool Startup(object[] rpcServerProtocols, 
            INetParser parser=null, XRpcSessionFlag flag = XRpcSessionFlag.Local|XRpcSessionFlag.Tcp|XRpcSessionFlag.Web|XRpcSessionFlag.Http)
        {
            var defaultParser = parser ?? new XNetInternalParser();
            XNetUtility.SetParser(defaultParser);

            // register internal protocols
            RegisterProtocol(new XNetDefaultClientProtocol());
            RegisterProtocol(new XNetDefaultServerProtocol());

            // register exten protocols
            foreach (var protocol in rpcServerProtocols)
            {
                RegisterProtocol(protocol);
            }

            RegisterSessionFactorys(flag);

            return true;
        }

        /// <summary>
        /// register session factorys
        /// </summary>
        /// <param name="flag"></param>
        /// <returns></returns>
        private static bool RegisterSessionFactorys(XRpcSessionFlag flag)
        {
            if (flag.HasFlag(XRpcSessionFlag.Tcp))
            {
                RegisterSessionFactory(XRpcType.Tcp,
                    new XTcpSessionFactory());
            }

            if (flag.HasFlag(XRpcSessionFlag.Web))
            {
                RegisterSessionFactory(XRpcType.Web,
                    new XWebSessionFactory());
            }

            if (flag.HasFlag(XRpcSessionFlag.Http))
            {
                RegisterSessionFactory(XRpcType.Http,
                    new XHttpSessionFactory());
            }

            return true;
        }

        /// <summary>
        /// register session factory
        /// </summary>
        /// <param name="type"></param>
        /// <param name="factory"></param>
        public static void RegisterSessionFactory(XRpcType type, XNetSessionFactory factory)
        {
            if (!factorys.ContainsKey(type))
                factorys.Add(type, factory);
        }

        /// <summary>
        /// get session factory
        /// </summary>
        /// <param name="type"></param>
        /// <returns></returns>
        public static XNetSessionFactory GetSessionFactory(XRpcType type)
        {
            if (!factorys.ContainsKey(type))
                return null;

            return factorys[type];
        }

        /// <summary>
        /// unregister session factory
        /// </summary>
        /// <param name="type"></param>
        public static void UnregisterSessionFactory(XRpcType type)
        {
            if (factorys.ContainsKey(type))
                factorys.Remove(type);
        }

        /// <summary>
        /// try create remote server
        /// </summary>
        /// <param name="rpcServerInfo"></param>
        /// <param name="session"></param>
        /// <returns></returns>
        public static bool TryCreateServer(XRpcServerInfo rpcServerInfo, out XNetSession session)
        {
            var factory = GetSessionFactory(rpcServerInfo.type);
            if (factory == null)
                throw new NullReferenceException();

            session = factory.Create(rpcServerInfo);
#if UNITY_EDITOR
            NetLog($"[XNetRpc] create server type {rpcServerInfo.type} " +
                $"address {rpcServerInfo.addr}:{rpcServerInfo.port}");
#endif
            sessions.Add(rpcServerInfo.type, session);

            return true;
        }

        /// <summary>
        /// create remote server
        /// </summary>
        /// <param name="server"></param>
        /// <returns></returns>
        public static XNetSession CreateServer(XRpcServerInfo server)
        {
            var factory = GetSessionFactory(server.type);
            if (factory == null)
                throw new NullReferenceException();

            var session = factory.Create(server);
#if UNITY_EDITOR
            NetLog($"[XNetRpc] create server type {server.type} " +
                $"address {server.addr}:{server.port}");
#endif
            sessions.Add(server.type, session);

            return session;
        }

        /// <summary>
        /// get rpc method
        /// </summary>
        /// <param name="name"></param>
        /// <param name="hash"></param>
        /// <returns></returns>
        public static XRpcMethod GetMethod(string name, int hash)
        {
            if (!serverCallClientProtocol.TryGetValue(hash, out var clientMethod))
                return null;

            return clientMethod.GetMethod(name);
        }

        /// <summary>
        /// get session
        /// </summary>
        /// <param name="sessionType"></param>
        /// <returns></returns>
        public static bool TryGetSession(XRpcType sessionType, out XNetSession session)
        {
            return sessions.TryGetValue(sessionType, out session);
        }

        /// <summary>
        /// destroy server
        /// </summary>
        /// <param name="sessionType"></param>
        public static void DestroyServer(XRpcServerInfo rpcServerInfo)
        {
            DestroyServer(rpcServerInfo.type);
        }

        /// <summary>
        /// destroy server
        /// </summary>
        /// <param name="type"></param>
        public static void DestroyServer(XRpcType type)
        {
            if (sessions.TryGetValue(type, out var session))
            {
                session.Close();

#if UNITY_EDITOR
                NetLog($"[XNetRpc] destroy server type {session.Type} host {session.Addr}:{session.Port}");
#endif
                sessions.Remove(type);
            }
        }

        /// <summary>
        /// call remote server by hash
        /// </summary>
        /// <param name="sessionType"></param>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public static bool CallHash(XRpcType sessionType, int hash, params object[] args)
        {
            if (!sessions.TryGetValue(sessionType, out var session))
            {
                NetLogError($"Can't find session type {sessionType}");
                return false;
            }

            if (!session.Connected())
            {
                session.Disconnect();
                return false;
            }
            
            // serialize rpc method param and make net packet
            var packet = XNetUtility.Serialize(sessionType, hash, args);

            // in editor env add rpc method track info
            #region EDITOR
#if UNITY_EDITOR
            var iclock = XNetUtility.Iclock();
            if (!XNetAnalytics.TryGetMethod(sessionType, GetProtocolNameByHash(hash), out var method))
                return false;
            
            if (!method.enabled)
                return false;

            if (method.delay > 0)
            {
                XNetCoroutine.Run(OnDelaySendPacket(method.delay, ()=> {
                    SendPacket(session, packet, hash, args);

                    // delay finished refresh method track info
                    method.sendTime = iclock;
                    method.send++;
                    method.sendByte += packet.RealSize;
                }));
                
                return true;
            }
            else
            {
                method.sendTime = iclock;
                method.send++;
                method.sendByte += packet.RealSize;
            }
#endif
            #endregion

            // in relse env send packet to server
            SendPacket(session, packet, hash, args);

            return true;
        }

        /// <summary>
        /// send net packet to server
        /// </summary>
        /// <param name="session"></param>
        /// <param name="rpcType"></param>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        static void SendPacket(XNetSession session, XNetPacket packet, int hash, params object[] args)
        {
            session.SendPacket(packet);

            // if param has a Action then add the Action to wait queue
            if (args.Length > 0)
            {
                var done = args[args.Length - 1] as Action;
                if (done is Delegate)
                    XNetWait.Add(hash, done);
            }
        }

#if UNITY_EDITOR
        /// <summary>
        /// force delay send packet
        /// </summary>
        /// <param name="delay"></param>
        /// <param name="session"></param>
        /// <param name="rpcType"></param>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        static IEnumerator OnDelaySendPacket(long delay, Action complete)
        {
            yield return new WaitForSeconds(delay * 0.001f);
            complete?.Invoke();
        }
#endif

        /// <summary>
        /// call server web session by hash
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public static void CallWebHash(int hash, params object[] args)
        {
            CallHash(XRpcType.Web, hash, args);
        }

        /// <summary>
        /// send net packet to server, default inject
        /// </summary>
        /// <param name="name"></param>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public static void CallTcpHash(int hash, params object[] args)
        {
            CallHash(XRpcType.Tcp, hash, args);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public static void CallKcpHash(int hash, params object[] args)
        {
            throw new NotImplementedException();
        }

        /// <summary>
        /// call server
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        public static void CallTcpServer(string name, params object[] args)
        {
            int hash = GetProtocolHashByMethod(name);
            if (sessions.TryGetValue(XRpcType.Tcp, out var tcpSession))
            {
#if UNITY_EDITOR
                var iclock = XNetUtility.Iclock();
#endif
                if (tcpSession.Connected())
                {
                    var packet = XNetUtility.Serialize(XRpcType.Tcp, hash, args);
                    tcpSession.SendPacket(packet);

                    if (args.Length > 0)
                    {
                        var done = args[args.Length] as Action;
                        if (done is Delegate)
                            XNetWait.Add(hash, done);
                    }
                }
                else
                {
#if UNITY_EDITOR
                    NetLogError($"Rpc call tcp server error {hash}={GetProtocolNameByHash(hash)} params {args.Length} net disconnected");
#endif
                }
            }
        }


        /// <summary>
        /// call server http session
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="name"></param>
        /// <param name="body"></param>
        /// <param name="complete"></param>
        public static void CallHttpServer<T>(string name, object body, Action<int, T> complete)
        {
            if (sessions.TryGetValue(XRpcType.Http, out var session))
            {
                var httpSession = session as XHttpSession;
                if (httpSession != null)
                {
                    httpSession.Post<T>(name, body, (code, data) => {
                        var packet = XNetUtility.Serialize(XRpcType.Http, name, code, data);
                        packet.Finish();

                        ServerCallClientMethod(packet);

                        complete?.Invoke(code, data);
                    });
                }
            }
        }

        /// <summary>
        /// update rpc
        /// </summary>
        public static void Update(float deltaTime)
        {
            var recvQueue = XNetMessageQueue.GetRecvQueue();
            while(recvQueue.Count > 0)
            {
                XNetPacket packet = null;
                lock (recvQueue)
                    packet = recvQueue.Dequeue();

                if (packet != null)
                {
                    ServerCallClientMethod(packet);

                    // recycle net packet
                    XNetPacketPool.Recycle(packet);
                }
            }
        }

        /// <summary>
        /// shutdown rpc
        /// </summary>
        public static void Shutdown()
        {
            foreach (var session in sessions)
            {
                session.Value.Close();
            }

            sessions.Clear();
        }
#pragma warning restore IDE0090
    }
}