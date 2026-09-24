using System.Collections.Generic;

namespace Oathx.Rpc.Editor
{
    [System.Serializable]
    public class XRpcEditorMethod : XRpcTreeElement
    {
        /// <summary>
        /// rpc session type
        /// </summary>
        public XRpcType type;
        /// <summary>
        /// enabled or disabled
        /// </summary>
        public bool enabled;
        /// <summary>
        /// method flag 0 client method 1 server method
        /// </summary>
        public int flag;
        /// <summary>
        /// protocoal hash
        /// </summary>
        public int hash;
        /// <summary>
        /// net ping value
        /// </summary>
        public uint ping;
        /// <summary>
        /// send count
        /// </summary>
        public int send;
        /// <summary>
        /// recv count
        /// </summary>
        public int recv;
        /// <summary>
        /// client call time
        /// </summary>
        public uint call;
        /// <summary>
        /// send total bytes
        /// </summary>
        public long sendBytes;
        /// <summary>
        /// recv total bytes
        /// </summary>
        public long recvBytes;

        /// <summary>
        /// editor display name
        /// </summary>
        public string displayName;
        /// <summary>
        /// packet real send time(ms)
        /// </summary>
        public long sendTime;
        /// <summary>
        /// packet real recv time(ms)
        /// </summary>
        public long recvTime;
        /// <summary>
        /// packet delay time(ms)
        /// </summary>
        public long delay;
        /// <summary>
        /// set rpc method only send
        /// </summary>
        public bool onlySend;
        
        /// <summary>
        /// server methods
        /// </summary>
        public List<string> 
            serverMethods = new List<string>();

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <param name="depth"></param>
        /// <param name="id"></param>
        public XRpcEditorMethod(string name, int depth, int id)
            : base(name, depth, id)
        {
            displayName = name;
            enabled = true;
        }
    }
}
