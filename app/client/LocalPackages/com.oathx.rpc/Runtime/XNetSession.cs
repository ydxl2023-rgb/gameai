using System;

namespace Oathx.Rpc
{
    public class RpcInterfaceAttribute : Attribute
    {

    }

    /// <summary>
    /// rpc client call server
    /// </summary>
    public class RpcClientCallServer : Attribute
    {
        /// <summary>
        /// rpc session type
        /// </summary>
        private XRpcType rpcSessionType;

        /// <summary>
        /// rpc special hash
        /// </summary>
        private int hashCode;

        /// <summary>
        /// session type
        /// </summary>
        public XRpcType SessionType => GetRpcSessionType();

        /// <summary>
        /// hash code
        /// </summary>
        public int HashCode => hashCode;

        /// <summary>
        /// rpc client call server
        /// </summary>
        /// <param name="sessionType"></param>
        public RpcClientCallServer(XRpcType sessionType=XRpcType.Tcp, int callHashCode=0)
        {
            rpcSessionType = sessionType;
            hashCode = callHashCode;
        }

        /// <summary>
        /// get rpc session type
        /// </summary>
        /// <returns></returns>
        public XRpcType GetRpcSessionType()
        {
            return rpcSessionType;
        }
    }

    /// <summary>
    /// rpc offline call local
    /// </summary>
    public class RpcOfflineCallLocal : Attribute
    { }

    /// <summary>
    /// rpc server call client
    /// </summary>
    public class RpcServerCallClient : Attribute
    {
        private XRpcType rpcSessionType;
        private int hashCode;

        /// <summary>
        /// session type
        /// </summary>
        public XRpcType sessionType => GetRpcSessionType();

        /// <summary>
        /// hash code
        /// </summary>
        public int HashCode => hashCode;

        /// <summary>
        /// rpc server call client
        /// </summary>
        /// <param name="sessionType"></param>
        public RpcServerCallClient(XRpcType sessionType = XRpcType.Tcp, int callHashCode=0)
        {
            rpcSessionType = sessionType;
            hashCode = callHashCode;
        }

        /// <summary>
        /// get rpc session type
        /// </summary>
        /// <returns></returns>
        public XRpcType GetRpcSessionType()
        {
            return rpcSessionType;
        }
    }


    /// <summary>
    /// internal rpc event
    /// </summary>
    public enum RpcInternal
    {
        ConnectStarted,
        ConnectFailure,
        ConnectSucceed,
    }

    /// <summary>
    /// xnet session
    /// </summary>
    public abstract class XNetSession
    {
        /// <summary>
        /// host address
        /// </summary>
        public string Host 
        { get; protected set; }

        /// <summary>
        /// ip address
        /// </summary>
        public string Addr
        { get; protected set; }

        /// <summary>
        /// 
        /// </summary>
        public int Port
        { get; protected set; }

        /// <summary>
        /// 
        /// </summary>
        public int Reconnect
        { get; protected set; }

        /// <summary>
        /// 
        /// </summary>
        public XRpcType Type
        { get; protected set; }

        /// <summary>
        /// connect to server
        /// </summary>
        /// <param name="host"></param>
        /// <param name="ipAddress"></param>
        /// <param name="nPort"></param>
        /// <returns></returns>
        public virtual bool Connect(string host, string ipAddress, int nPort)
        {
            Host = host ?? ipAddress;
            Addr = ipAddress;
            Port = nPort;

            return true;
        }

        /// <summary>
        /// disconnect from server
        /// </summary>
        public abstract void Disconnect();

        /// <summary>
        /// send packet to server
        /// </summary>
        /// <param name="packet"></param>
        public abstract void SendPacket(XNetPacket packet);

        /// <summary>
        /// send rpc to server
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public abstract void Send(int hash, params object[] args);

        /// <summary>
        /// send rpc to server
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        public abstract void Send(string name, params object[] args);

        /// <summary>
        /// post packet to server
        /// </summary>
        /// <param name="IPacket"></param>
        public abstract void PostPacket(XNetPacket IPacket);

        /// <summary>
        /// close session
        /// </summary>
        public abstract void Close();

        /// <summary>
        /// check connected
        /// </summary>
        /// <returns></returns>
        public abstract bool Connected();
    }

    /// <summary>
    /// rpc session type
    /// </summary>
    public enum XRpcType
    {
        Local,
        Tcp,
        Kcp,
        Web,
        Http,
        All
    }

    /// <summary>
    /// rpc session flag
    /// </summary>
    public enum XRpcSessionFlag
    {
       Local = 0,
       Tcp = 1,
       Kcp = 2,
       Web = 4,
       Http = 8,
    }

    /// <summary>
    /// rpc server info
    /// </summary>

    [Serializable]
    public class XRpcServerInfo
    {
        /// <summary>
        /// type
        /// </summary>
        public XRpcType type;

        /// <summary>
        /// host
        /// </summary>
        public string host;

        /// <summary>
        /// rpc server address
        /// </summary>
        public string addr;

        /// <summary>
        /// rpc server port
        /// </summary>
        public int port;
    }

    /// <summary>
    /// session factory
    /// </summary>
    public abstract class XNetSessionFactory
    {
        /// <summary>
        /// create session
        /// </summary>
        /// <param name="configure"></param>
        /// <returns></returns>
        public abstract XNetSession Create(XRpcServerInfo configure);

        /// <summary>
        /// destroy session
        /// </summary>
        /// <param name="session"></param>
        public abstract void Destroy(XNetSession session);
    }
}
