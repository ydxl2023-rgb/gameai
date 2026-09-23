using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

using UnityEngine;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Verifies JIRA access without persisting credentials or following redirects.
    /// </summary>
    public static class JiraConnectionClient
    {
        /// <summary>Requests the authenticated JIRA user with a fifteen-second HTTP timeout.</summary>
        /// <returns>The authenticated user's display name.</returns>
        /// <exception cref="ArgumentException">The address or token is invalid.</exception>
        /// <exception cref="InvalidOperationException">Authentication, transport, or response validation fails.</exception>
        /// <exception cref="OperationCanceledException">The caller cancels or the HTTP request times out.</exception>
        public static async Task<string> TestAsync(JiraConnectionSettings settings, string secret, CancellationToken cancellation)
        {
            settings = settings.Normalized();
            if (string.IsNullOrWhiteSpace(secret) || secret.Contains("\r") || secret.Contains("\n"))
            {
                throw new ArgumentException("Enter a valid access token.");
            }

            // Do not forward credentials through redirects to login pages or another host.
            using (HttpClientHandler handler = new HttpClientHandler
            {
                AllowAutoRedirect = false,
                UseCookies = false
            })
            {
                using (HttpClient client = new HttpClient(handler))
                {
                    using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, settings.address + "/rest/api/2/myself"))
                    {
                        client.Timeout = TimeSpan.FromSeconds(15);
                        client.MaxResponseContentBufferSize = 1024 * 1024;
                        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);
                        try
                        {
                            using (HttpResponseMessage response = await client.SendAsync(request, cancellation).ConfigureAwait(false))
                            {
                                if (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden)
                                {
                                    throw new InvalidOperationException("Authentication was rejected. Check the access token and JIRA permissions.");
                                }

                                if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
                                {
                                    throw new InvalidOperationException("JIRA redirected the request. Check the base address and API authentication.");
                                }

                                if (!response.IsSuccessStatusCode)
                                {
                                    throw new InvalidOperationException("JIRA connection test failed (HTTP " + (int)response.StatusCode + ").");
                                }

                                string mediaType = response.Content.Headers.ContentType?.MediaType;
                                if (mediaType == null || !mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase))
                                {
                                    throw new InvalidOperationException("The server did not return a JIRA JSON response.");
                                }

                                string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                                JiraUser user;
                                try
                                {
                                    user = JsonUtility.FromJson<JiraUser>(json);
                                }
                                catch (ArgumentException)
                                {
                                    throw new InvalidOperationException("JIRA returned an invalid user response.");
                                }

                                if (user == null || string.IsNullOrEmpty(user.displayName) || (string.IsNullOrEmpty(user.accountId) && string.IsNullOrEmpty(user.name)))
                                {
                                    throw new InvalidOperationException("JIRA did not confirm an authenticated user.");
                                }

                                return user.displayName;
                            }
                        }
                        catch (HttpRequestException)
                        {
                            throw new InvalidOperationException("Cannot reach JIRA. Check the address, network and TLS certificate.");
                        }
                    }
                }
            }
        }

        [Serializable]
        private sealed class JiraUser
        {
            public string displayName = "";

            public string accountId = "";

            public string name = "";
        }
    }
}
