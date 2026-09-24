namespace Oathx.Rpc
{
	/// <summary>
	/// 
	/// </summary>
	public class XWebSessionFactory : XNetSessionFactory
	{
		/// <summary>
		/// 
		/// </summary>
		/// <param name="configure"></param>
		/// <returns></returns>
		public override XNetSession Create(XRpcServerInfo configure)
		{
			if (configure.type != XRpcType.Web)
				throw new System.NotImplementedException(configure.type.ToString());

			XNetSession session = new XWebSession(configure.type);
			session.Connect(configure.host, configure.addr, configure.port);

			return session;
		}

		/// <summary>
		/// 
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