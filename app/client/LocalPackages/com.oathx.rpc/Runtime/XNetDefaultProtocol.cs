using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Oathx.Rpc
{
	public class XNetDefaultServerProtocol
	{
		[RpcServerCallClient]
		public void ConnectStarted(XRpcType type, string host, string address, int port)
		{
#if UNITY_EDITOR
			Debug.Log($"[{Time.frameCount}] Server call ConnectStarted " +
				$"{type} {host} {address}:{port}");
#endif
		}

		[RpcServerCallClient]
		public void ConnectFailure(XRpcType type, string host, string address, int port)
		{
#if UNITY_EDITOR
			Debug.Log($"[{Time.frameCount}] Server call ConnectFailure" +
				$" {type} {host} {address}:{port}");
#endif
		}

		[RpcServerCallClient]
		public void ConnectSucceed(XRpcType type, string host, string address, int port)
		{
#if UNITY_EDITOR
			Debug.Log($"[{Time.frameCount}] Server call ConnectSuccess " +
				$"{type} {host} {address}:{port}");
#endif
		}
	}

	public class XNetDefaultClientProtocol
	{
		[RpcClientCallServer]
		public void ConnectStarted()
		{
			Debug.Log($"Client call ConnectStart");
		}

		[RpcClientCallServer]
		public void ConnectFailure()
		{
			Debug.Log($"Client call ConnectFailure");
		}

		[RpcClientCallServer]
		public void ConnectSucceed()
		{
			Debug.Log($"Client call ConnectSuccess");
		}
	}
}