using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// 
    /// </summary>
    /// <typeparam name="T"></typeparam>
    [System.Serializable]
    public class XHttpResponse<T>
    {
        public int code;
        public T data;
        public string error;
    }

    /// <summary>
    /// xhttp session
    /// </summary>
    public class XHttpSession : XNetSession
    {
        /// <summary>
        /// rpc post elapsed
        /// </summary>
        static readonly Dictionary<string, uint> elapseds = new Dictionary<string, uint>();

        /// <summary>
        /// constructor
        /// </summary>
        /// <param name="rpc"></param>
        public XHttpSession(XRpcType type)
        {
            Type = type;
            XHttp.IgnoreCertificate(true);
        }

        /// <summary>
        /// to string
        /// </summary>
        /// <returns></returns>
        public override string ToString()
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine($"Type: {Type}");
            sb.AppendLine($"Host: {Host}");
            sb.AppendLine($"Addr: {Addr}:{Port}");
            
            return sb.ToString();
        }

        /// <summary>
        /// connect to server
        /// </summary>
        /// <param name="host"></param>
        /// <param name="addr"></param>
        /// <param name="port"></param>
        /// <returns></returns>
        public override bool Connect(string host, string addr, int port)
        {
            if (!base.Connect(host, addr, port))
                return false;
            
            var packet = XNetUtility.Serialize(XRpcType.Http, RpcInternal.ConnectSucceed.ToString(), Type, Host, Addr, Port);
            PostPacket(packet);

            return true;
        }

        /// <summary>
        /// disconnect from server
        /// </summary>
        public override void Disconnect()
        {
            throw new System.NotImplementedException($"Http not implement this function");
        }

        /// <summary>
        /// dispatch packet
        /// </summary>
        /// <param name="packet"></param>
        public override void SendPacket(XNetPacket packet)
        {
            throw new System.NotImplementedException($"Http not implement this function");
        }

        /// <summary>
        /// send with hash
        /// </summary>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        public override void Send(int hash, params object[] args)
        {
            throw new System.NotImplementedException($"Http not implement this function");
        }

        /// <summary>
        /// post http request
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="url"></param>
        /// <param name="body"></param>
        /// <param name="complete"></param>
        /// <returns></returns>
        public bool Post<T>(string name, object body, System.Action<int, T> complete)
        {
            string json = Newtonsoft.Json.JsonConvert.SerializeObject(body);
            if (string.IsNullOrEmpty(json))
                return false;

            string host = string.IsNullOrEmpty(Host) ? Addr : Host;

            #region EDITOR
#if UNITY_EDITOR
            uint reqAt = XNetUtility.Iclock();
            if (!elapseds.ContainsKey(name))
                elapseds.Add(name, reqAt);

            elapseds[name] = reqAt;

            if (!XNetAnalytics.TryGetMethod(XRpcType.Http, name, out var method))
                return false;

            if (!method.enabled)
                return false;

            method.send++;
            method.sendTime = reqAt;
            method.sendByte = json.Length;
#endif
            #endregion

            string url = string.IsNullOrEmpty(host) ? $"{host}:{Port}/{name}" : $"{host}/{name}";
            XHttp.PostJson(url, json, (bool success, string data) =>{
                uint rcvAt = XNetUtility.Iclock();

                #region EDITOR
#if UNITY_EDITOR
                method.ping = rcvAt - rcvAt - elapseds[name];
                if (method.onlySend)
                    return;

                method.recv++;
#endif
                #endregion

                Debug.Log($"[Http.Recv] {url} {success} response {data}");
                if (success)
                {
                    var result = Newtonsoft.Json.JsonConvert.DeserializeObject<XHttpResponse<T>>(data);
                    complete?.Invoke(result.code, result.data);
                }
                else
                {
                    Debug.LogError($"[Http.Recv] Http send packet failure {data}");

                    var packet = XNetUtility.Serialize(XRpcType.Http, RpcInternal.ConnectFailure.ToString(),
                        Type, Host, Addr, Port);

                    PostPacket(packet);
                }
            });
       

            return true;
        }


        /// <summary>
        /// send with name
        /// </summary>
        /// <param name="name"></param>
        /// <param name="args"></param>
        public override void Send(string name, params object[] args)
        {
            throw new System.NotImplementedException($"Http not implement this function");
        }

        /// <summary>
        /// post packet
        /// </summary>
        /// <param name="IPacket"></param>
        public override void PostPacket(XNetPacket packet)
        {
            XNetMessageQueue.PostPacket(packet);
        }

        /// <summary>
        /// close session
        /// </summary>
        public override void Close()
        {
#if UNITY_EDITOR || UNITY_DEVELOP
            string ipAddress = string.IsNullOrEmpty(Host) ? $"{Addr}:{Port}" : $"{Host}:{Port}";
            Debug.Log($"[{Time.frameCount}] [Http.Close] {Type} {ipAddress}");
#endif
        }

        /// <summary>
        /// connected status
        /// </summary>
        /// <returns></returns>
        public override bool Connected()
        {
            return true;
        }
    }
}
