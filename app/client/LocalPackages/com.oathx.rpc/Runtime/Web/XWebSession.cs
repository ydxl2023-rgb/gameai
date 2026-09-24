using UnityWebSocket;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// 
    /// </summary>
    public class XWebSession : XNetSession
    {
        /// <summary>
        /// websocket object
        /// </summary>
        private IWebSocket socket = null;

        /// <summary>
        /// 
        /// </summary>
        /// <param name="configure"></param>
        public XWebSession(XRpcType type)
        {
            Type = type;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="host"></param>
        /// <param name="ipAddress"></param>
        /// <param name="nPort"></param>
        /// <returns></returns>
        public override bool Connect(string host, string ipAddress, int nPort)
        {
#if UNITY_EDITOR || UNITY_DEVELOP
            Debug.Log($"Web Socket connectd {ipAddress}:{nPort}");
#endif
            if (!base.Connect(host, ipAddress, nPort))
                return false;

            bool result = Connected();
            if (result)
            {
#if UNITY_EDITOR || UNITY_DEVELOP
                Debug.LogError($"Web Socket already connectd {ipAddress}:{nPort}");
#endif
                return true;
            }
            else
            {
                var wss = string.IsNullOrEmpty(host) ? ipAddress : host;
                socket = new WebSocket(wss);

                socket.OnOpen += OnOpened;
                socket.OnMessage += OnMessage;
                socket.OnClose += OnClose;
                socket.OnError += OnError;

                // notify connect start packet
                PostPacket(XNetUtility.Serialize(XRpcType.Web, RpcInternal.ConnectStarted.ToString(), 
                    Type, Host, Addr, Port));

                // try async connect to server
                socket.ConnectAsync();
            }

            return true;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void OnOpened(object sender, OpenEventArgs e)
        {
            PostPacket(XNetUtility.Serialize(XRpcType.Web, RpcInternal.ConnectSucceed.ToString(), Type, Host, Addr, Port));
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void OnMessage(object sender, MessageEventArgs e)
        {
            if (e.IsBinary)
            {
                var packet = XNetPacketPool.Alloc(XRpcType.Web);
                packet.Set(e.RawData.Length - sizeof(int), e.RawData, 4);

                PostPacket(packet);
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void OnClose(object sender, CloseEventArgs e)
        {
            PostPacket(XNetUtility.Serialize(XRpcType.Web, RpcInternal.ConnectFailure.ToString(), Type, Host, Addr, Port, e.Reason));
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="sender"></param>
        /// <param name="e"></param>
        private void OnError(object sender, ErrorEventArgs e)
        {
            PostPacket(XNetUtility.Serialize(XRpcType.Web, RpcInternal.ConnectFailure.ToString(), Type, Host, Addr, Port, e.Message));
        }

        /// <summary>
        /// 
        /// </summary>
        public override void Disconnect()
        {
            if (socket.ReadyState != WebSocketState.Closed)
            {
                // close socket
                socket.CloseAsync();
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="packet"></param>
        public override void SendPacket(XNetPacket packet)
        {
            packet.Finish();

            var bytes = packet.GetBytes();
            socket.SendAsync(bytes);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public override void Send(int hash, params object[] args)
        {
            var packet = XNetUtility.Serialize(XRpcType.Web, hash, args);
            SendPacket(packet);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        public override void Send(string name, params object[] args)
        {
            var packet = XNetUtility.Serialize(XRpcType.Web, XNetUtility.HashString(name), args);
            SendPacket(packet);
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="IPacket"></param>
        public override void PostPacket(XNetPacket packet)
        {
            XNetMessageQueue.PostPacket(packet);
        }

        /// <summary>
        /// 
        /// </summary>
        public override void Close()
        {
            socket.CloseAsync();
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public override bool Connected()
        {
            return socket != null && socket.ReadyState == WebSocketState.Open;
        }
    }
}
