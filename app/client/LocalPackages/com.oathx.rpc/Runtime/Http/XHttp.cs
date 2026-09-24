using System;
using UnityEngine;
using UnityEngine.Networking;
using System.Security.Cryptography.X509Certificates;
using System.Collections;

namespace Oathx.Rpc
{
    /// <summary>
    /// certificate handler for self-signed certificate
    /// </summary>
    class CertificateHandlerSelfSigned : CertificateHandler
    {
        /// <summary>
        /// 
        /// </summary>
        private static string SignKey =
            "MIIBCgKCAQEAwpt8UVJp+1m/VnZSc3jf33Uu4Ouz1OwPreJHdLXJVxk/vIvjh/cs" +
            "s2P0sZLE3DXvP4Cylq3sKCVdWXoD+QGN2M+gRlFX1kETnmVY6FWTXjKJWO0tcb9l" +
            "g9lL40cAFNrw/FPkRk5/D+Y2TCTRJeVt7YDG7W0iPwRxqADLmM3Wk21eDoPVGBkB" +
            "QKajfNoJKvWdDXMq2paXkolCDTNCVcFe88ktJV//S/iMk4FRwgtpOoG5kt+0e+qL" +
            "7IMoTtZVG1MeidpHOAyqagS7IX0vkvK4y48DLbYvauSv9uJM1+xhG4W8eE284BQZ" +
            "Bsigma4gI/7kKqSFPc+I6hxUlzBpO/yb0QIDAQAB";

        /// <summary>
        /// ignore certificate error
        /// </summary>
        private bool _ignoreCert;

        /// <summary>
        /// constructor
        /// </summary>
        /// <param name="ignoreCert"></param>
        public CertificateHandlerSelfSigned(bool ignoreCert)
        {
            _ignoreCert = ignoreCert;
        }

        /// <summary>
        /// validate certificate
        /// </summary>
        /// <param name="certificateData"></param>
        /// <returns></returns>
        protected override bool ValidateCertificate(byte[] certificateData)
        {
            if (_ignoreCert)
            {
                return true;
            }

            X509Certificate2 certificate2 = new X509Certificate2(certificateData);

            string pk = Convert.ToBase64String(certificate2.GetPublicKey());
            if (pk.ToLower().Equals(SignKey.ToLower()))
            {
                return true;
            }
            else
            {
                return base.ValidateCertificate(certificateData);
            }
        }
    }

    /// <summary>
    /// http helper
    /// </summary>
    public class XHttp
    {
        private static bool ignoreCert = false;

        /// <summary>
        /// ingnore certificate error
        /// </summary>
        /// <param name="ignore"></param>
        public static void IgnoreCertificate(bool ignore)
        {
            ignoreCert = ignore;
        }

        static readonly XHttp http;

        /// <summary>
        /// xhttp constructor
        /// </summary>
        static XHttp()
        {
            http = new XHttp();
        }

        /// <summary>
        /// post json data
        /// </summary>
        /// <param name="url"></param>
        /// <param name="data"></param>
        /// <param name="complete"></param>
        /// <returns></returns>
        IEnumerator OnPostJson(string url, string data, Action<bool, string> complete)
        {
            UnityWebRequest request = UnityWebRequest.Put(url, data);
            request.certificateHandler = new CertificateHandlerSelfSigned(ignoreCert);
            request.method = UnityWebRequest.kHttpVerbPOST;

            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Accept", "application/json");

            Debug.Log($"[Http.Post] [{url}] data {data}");

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                complete(true, request.downloadHandler.text);
            }
            else
            {
                complete(false, request.error);
            }

            request.Dispose();
        }

        /// <summary>
        /// post json data
        /// </summary>
        /// <param name="url"></param>
        /// <param name="data"></param>
        /// <param name="complete"></param>
        public static void PostJson(string url, string data, Action<bool, string> complete)
        {
            XNetCoroutine.Run(http.OnPostJson(url, data, complete));
        }
    }
}