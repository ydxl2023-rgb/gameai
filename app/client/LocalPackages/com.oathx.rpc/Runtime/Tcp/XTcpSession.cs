using System;
using System.Collections.Generic;
using System.Threading;
using System.Net.Sockets;
using System.Net;
using UnityEngine;

namespace Oathx.Rpc
{
	/// <summary>
	/// Net tcp state object.
	/// </summary>
	public class NetStateObject
	{
		/// <summary>
		/// The size of the buffer.
		/// </summary>
		public const int BufferSize = 1024 * 64;
		/// <summary>
		/// The work socket.
		/// </summary>
		public Socket workSocket = null;
		/// <summary>
		/// The buffer.
		/// </summary>
		public byte[] buffer = new byte[BufferSize];
		/// <summary>
		/// The write offset.
		/// </summary>
		public int writeOffset = 0;
		/// <summary>
		/// The read offset.
		/// </summary>
		public int readOffset = 0;
	}

	/// <summary>
	/// Net tcp session.
	/// </summary>
	public class XTcpSession : XNetSession
	{
		/// <summary>
		/// The socket.
		/// </summary>
		protected Socket socket = null;

		// socket thread
		protected Thread connThread = null;
		protected Thread sendThread = null;
		protected Thread recvThread = null;

        /// <summary>
        /// tcp session type
        /// </summary>
        /// <param name="configure"></param>
        public XTcpSession(XRpcType type)
        {
			Type = type;
        }

        /// <summary>
        /// Connect the specified ipAddress and nPort.
        /// </summary>
        /// <param name="ipAddress">Ip address.</param>
        /// <param name="nPort">N port.</param>
        public override bool Connect(string host, string szIPAddress, int nPort)
		{
#if UNITY_EDITOR || UNITY_DEVELOP
			Debug.Log($"Tcp Socket connectd {szIPAddress}:{nPort}");
#endif
			if (!base.Connect(host, szIPAddress, nPort))
				return false;

			bool result = Connected();
			if (result)
			{
#if UNITY_EDITOR || UNITY_DEVELOP
				Debug.LogError($"Tcp Socket already connectd {szIPAddress}:{nPort}");
#endif
				return true;
			}
			else
			{
				try
				{
					string serverAddress = string.IsNullOrEmpty(host) ? szIPAddress : host;

					IPAddress address;
					if (!IPAddress.TryParse(serverAddress, out address))
					{
						IPHostEntry entry = Dns.GetHostEntry(szIPAddress);
						if (entry.AddressList.Length > 0)
						{
							address = entry.AddressList[0];
						}
					}

					IPEndPoint remoteEP = new IPEndPoint(address, nPort);
					socket = remoteEP.AddressFamily == AddressFamily.InterNetworkV6 ? new Socket(AddressFamily.InterNetworkV6, SocketType.Stream,
						ProtocolType.Tcp) : new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
					socket.Blocking = true;

					socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.SendTimeout, 7000);
					socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.Linger, new LingerOption(true, 5));
					socket.SetSocketOption(SocketOptionLevel.Tcp, SocketOptionName.NoDelay, true);

					// start connect thread
					connThread = new Thread(new ParameterizedThreadStart(OnConnThread));
					connThread.Start(remoteEP);
				}
				catch (Exception e)
				{
#if UNITY_EDITOR || UNITY_DEVELOP
					Debug.LogError(e.Message);
#endif
					Close();

					return false;
				}
			}

			return true;
		}

		/// <summary>
		/// disconnect socket
		/// </summary>
		public override void Disconnect()
		{
			Thread.Sleep(33);

			// notify socket connect failure
			PostPacket(XNetUtility.Serialize(XRpcType.Tcp, RpcInternal.ConnectFailure.ToString(),
				Type, Host, Addr, Port));
		}

		/// <summary>
		/// Sends the packet.
		/// </summary>
		/// <param name="packet">Packet.</param>
		public override void SendPacket(XNetPacket packet)
		{
			XNetMessageQueue.SendPacket(packet);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="hash"></param>
		/// <param name="args"></param>
        public override void Send(int hash, params object[] args)
        {
			var packet = XNetUtility.Serialize(XRpcType.Tcp, hash, args);
			SendPacket(packet);
        }

		/// <summary>
		/// 
		/// </summary>
		/// <param name="name"></param>
		/// <param name="args"></param>
		public override void Send(string name, params object[] args)
		{
			var packet = XNetUtility.Serialize(XRpcType.Tcp, XNetUtility.HashString(name), args);
			SendPacket(packet);
		}

		/// <summary>
		/// Posts the packet.
		/// </summary>
		/// <param name="IPacket">I packet.</param>
		public override void PostPacket(XNetPacket packet)
		{
			XNetMessageQueue.PostPacket(packet);
		}

        /// <summary>
        /// Close this instance.
        /// </summary>
        public override void Close()
		{
			if (connThread != null && connThread.IsAlive)
				connThread.Abort();

			if (sendThread != null && sendThread.IsAlive)
				sendThread.Abort();

			if (recvThread != null && recvThread.IsAlive)
				recvThread.Abort();

			if (socket != null)
            {
				if (socket.Connected)
					socket.Shutdown(SocketShutdown.Both);

				socket.Close();
				socket = null;
            }
		}

		/// <summary>
		/// Connected this instance.
		/// </summary>
		public override bool Connected()
		{
			return socket != null && socket.Connected;
		}

		/// <summary>
		/// Raises the conn thread event.
		/// </summary>
		/// <param name="ipEndPoint">Ip end point.</param>
		public void OnConnThread(object ipEndPoint)
		{
			IPEndPoint remoteEP = (IPEndPoint)ipEndPoint;
			try
			{
				PostPacket(XNetUtility.Serialize(XRpcType.Tcp, RpcInternal.ConnectStarted.ToString(), Type, Host, Addr, Port));

				// connect start
				socket.Connect(remoteEP);
				
				// start send thread
				sendThread = new Thread(new ThreadStart(OnSendThread));
				sendThread.Start();

				// start recv thread
				recvThread = new Thread(new ThreadStart(OnRecvThread));
				recvThread.Start();

				PostPacket(XNetUtility.Serialize(XRpcType.Tcp, RpcInternal.ConnectSucceed.ToString(), Type, Host, Addr, Port));
				
			}
			catch (Exception e)
			{
#if UNITY_EDITOR || UNITY_DEVELOP
				Debug.LogError(e.Message);
#endif
				Close();
			}

			connThread.Abort();
		}

		/// <summary>
		/// Raises the send thread event.
		/// </summary>
		/// <param name="o">O.</param>
		public void OnSendThread()
		{
			if (!socket.Poll(10000000, SelectMode.SelectWrite))
            {
				Disconnect();
			}
            else
            {
				var sendQueue = XNetMessageQueue.GetSendQueue();
				while (true)
				{
					if (!Connected())
                    {
						Disconnect();
						break;
					}

					if (sendQueue.Count > 0)
					{
						XNetPacket packet = null;

						lock (sendQueue)
						{
							packet = sendQueue.Dequeue();
						}

						if (packet != null)
						{
							int nSendBytes = socket.Send(packet.GetBytes(), 0, packet.Size + sizeof(int), SocketFlags.None);
							if (nSendBytes <= 0)
                            {
								Disconnect();
								break;
							}
						}
					}

					Thread.Sleep(0);
				}
			}
		}

		/// <summary>
		/// Raises the recv thread event.
		/// </summary>
		public void OnRecvThread()
		{
			NetStateObject netState = new NetStateObject();
			netState.workSocket = socket;

			while (true)
			{
				if (!Connected())
                {
					Disconnect();
					break;
				}

				int nReadBytes = socket.Receive(netState.buffer,
					netState.writeOffset, NetStateObject.BufferSize - netState.writeOffset, SocketFlags.None);
				if (nReadBytes <= 0)
                {
					Disconnect();
					break;
				}

				nReadBytes += netState.writeOffset;

				int nIndex = netState.readOffset;
				int nPacketSize = 0;

				while (nIndex < nReadBytes)
				{
					int nOffset = netState.readOffset;
					nPacketSize = BitConverter.ToInt32(netState.buffer, nOffset);
					nPacketSize = IPAddress.NetworkToHostOrder(nPacketSize);

					if (nIndex + sizeof(int) + nPacketSize <= nReadBytes)
					{
						nOffset += sizeof(int);

						XNetPacket packet = XNetPacketPool.Alloc(XRpcType.Tcp);
						packet.Set(nPacketSize, netState.buffer, nOffset);

						if (packet.Type != 0)
						{
							PostPacket(packet);
						}

						netState.readOffset += (sizeof(int) + nPacketSize);
					}

					nIndex += (sizeof(int) + nPacketSize);
				}

				if (nIndex == nReadBytes)
				{
					netState.readOffset = 0;
					netState.writeOffset = 0;
				}
				else
				{
					if (netState.readOffset + nPacketSize > NetStateObject.BufferSize)
					{
						byte[] newBuffer = new byte[NetStateObject.BufferSize];

						int bytesCopy = nReadBytes - netState.readOffset;
						Buffer.BlockCopy(netState.buffer,
							netState.readOffset, newBuffer, 0, bytesCopy);

						netState.buffer = newBuffer;
						netState.readOffset = 0;
						netState.writeOffset = bytesCopy;

#if UNITY_EDITOR || UNITY_DEVELOP
						Debug.Log($"Tcp Receive create new buffer readOffset {netState.readOffset} packetSize {nPacketSize} writeOffset {netState.writeOffset}");
#endif
					}
					else
					{
						netState.writeOffset = nReadBytes;
					}
				}

				Thread.Sleep(0);
			}			
		}
	}
}
