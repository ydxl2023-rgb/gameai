using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// http session factory
    /// </summary>
    public class XHttpSessionFactory : XNetSessionFactory
    {
        /// <summary>
        /// create session
        /// </summary>
        /// <param name="configure"></param>
        /// <returns></returns>
        public override XNetSession Create(XRpcServerInfo server)
        {
            if (server.type != XRpcType.Http)
                throw new System.NotImplementedException(server.type.ToString());

            var session = new XHttpSession(server.type);
            session.Connect(server.host, server.addr, server.port);

            return session;
        }

        /// <summary>
        /// destroy session
        /// </summary>
        /// <param name="session"></param>
        public override void Destroy(XNetSession session)
        {
            if (session != null)
                session.Close();
        }
    }
}
