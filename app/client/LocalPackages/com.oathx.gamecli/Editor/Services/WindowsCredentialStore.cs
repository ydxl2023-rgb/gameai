using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Oathx.GameCLI.Editor
{
    /// <summary>
    /// Owns native Windows credential buffers and releases them after each operation.
    /// </summary>
    public static class WindowsCredentialStore
    {
        private const int GenericCredential = 1;

        private const int NotFound = 1168;

        /// <summary>Reads a generic credential, returning null when the target does not exist.</summary>
        /// <exception cref="Win32Exception">Windows rejects the credential lookup.</exception>
        public static string Read(string target)
        {
            if (!CredRead(target, GenericCredential, 0, out IntPtr pointer))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == NotFound)
                {
                    return null;
                }

                throw new Win32Exception(error, "Cannot read Windows credentials.");
            }

            try
            {
                Credential credential = Marshal.PtrToStructure<Credential>(pointer);
                return Marshal.PtrToStringUni(credential.blob, (int)credential.blobSize / 2);
            }
            finally
            {
                CredFree(pointer);
            }
        }

        /// <summary>Saves a UTF-16 secret and zeroes the temporary unmanaged buffer afterward.</summary>
        /// <exception cref="ArgumentException">The encoded secret exceeds the native size limit.</exception>
        /// <exception cref="Win32Exception">Windows rejects the write.</exception>
        public static void Write(string target, string secret)
        {
            if (Encoding.Unicode.GetByteCount(secret) > 2560)
            {
                throw new ArgumentException("Credential exceeds Windows Credential Manager's supported size.");
            }

            IntPtr blob = Marshal.StringToCoTaskMemUni(secret);
            try
            {
                Credential credential = new Credential
                {
                    type = GenericCredential,
                    targetName = target,
                    blob = blob,
                    blobSize = (uint)Encoding.Unicode.GetByteCount(secret),
                    persist = 2,
                    userName = "GameCLI"
                };
                if (!CredWrite(ref credential, 0))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot save Windows credentials.");
                }
            }
            finally
            {
                Marshal.ZeroFreeCoTaskMemUnicode(blob);
            }
        }

        /// <summary>Deletes a credential; an already absent target is treated as success.</summary>
        public static void Delete(string target)
        {
            if (!CredDelete(target, GenericCredential, 0) && Marshal.GetLastWin32Error() != NotFound)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot remove Windows credentials.");
            }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Credential
        {
            public uint flags;

            public uint type;

            public string targetName;

            public string comment;

            public System.Runtime.InteropServices.ComTypes.FILETIME lastWritten;

            public uint blobSize;

            public IntPtr blob;

            public uint persist;

            public uint attributeCount;

            public IntPtr attributes;

            public string targetAlias;

            public string userName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CredWrite(ref Credential credential, int flags);

        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CredDelete(string target, int type, int flags);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr credential);
    }
}
