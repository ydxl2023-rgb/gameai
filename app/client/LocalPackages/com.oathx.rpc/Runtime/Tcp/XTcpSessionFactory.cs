namespace Oathx.Rpc
{
    /// <summary>
    /// tcp session factory
    /// </summary>
    public class XTcpSessionFactory : XNetSessionFactory
	{
        /// <summary>
        /// create session
        /// </summary>
        /// <param name="rpcServerInfo"></param>
        /// <returns></returns>
        public override XNetSession Create(XRpcServerInfo rpcServerInfo)
		{
			if (rpcServerInfo.type != XRpcType.Tcp)
				throw new System.NotImplementedException(rpcServerInfo.type.ToString());

			XNetSession session = new XTcpSession(rpcServerInfo.type);
			session.Connect(rpcServerInfo.host, rpcServerInfo.addr, rpcServerInfo.port);

			return session;
		}

        /// <summary>
        /// destroy session
        /// </summary>
        /// <param name="session"></param>
        public override void Destroy(XNetSession session)
		{
			if (session != null)
			{
				session.Close();
			}
		}
	}
}