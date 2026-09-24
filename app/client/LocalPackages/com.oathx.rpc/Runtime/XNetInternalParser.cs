using System;
using Newtonsoft.Json;

namespace Oathx.Rpc
{
    /// <summary>
    /// 
    /// </summary>
    public class XNetInternalParser : INetParser
    {
        /// <summary>
        /// 
        /// </summary>
        /// <param name="sessionType"></param>
        /// <param name="hash"></param>
        /// <param name="args"></param>
        /// <returns></returns>
        public XNetPacket Serialize(XRpcType sessionType, int hash, params object[] args)
        {
            XNetPacket packet = XNetPacketPool.Alloc(sessionType, hash);
            foreach (object arg in args)
            {
                if (arg is int)
                {
                    packet.WriteInt((int)arg);
                }
                else if (arg is uint)
                {
                    packet.WriteUInt((uint)arg);
                }
                else if (arg is long)
                {
                    packet.WriteLong((long)arg);
                }
                else if (arg is ulong)
                {
                    packet.WriteULong((ulong)arg);
                }
                else if (arg is string)
                {
                    packet.WriteString((string)arg);
                }
                else if (arg is short)
                {
                    packet.WriteShort((short)arg);
                }
                else if (arg is ushort)
                {
                    packet.WriteUShort((ushort)arg);
                }
                else if (arg is byte)
                {
                    packet.WriteByte((byte)arg);
                }
                else if (arg is char)
                {
                    packet.WriteChar((char)arg);
                }
                else if (arg is long)
                {
                    packet.WriteLong((long)arg);
                }
                else if (arg is bool)
                {
                    packet.WriteByte((byte)arg);
                }
                else if (arg is Enum)
                {
                    packet.WriteInt((int)arg);
                }
                else
                {
                    if (!(arg is Action))
                    {
                        var text = JsonConvert.SerializeObject(arg);
                        packet.WriteBigString(text);
                    }
                }
            }

            return packet;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="packet"></param>
        /// <param name="rpcParams"></param>
        /// <returns></returns>
        public object[] Deserialize(XNetPacket packet, Type[] rpcParams)
        {
            if (rpcParams != null)
            {
                object[] args = new object[rpcParams.Length];
                for (int i = 0; i < rpcParams.Length; i++)
                {
                    Type type = rpcParams[i];
                    if (type.Equals(typeof(int)))
                    {
                        args[i] = packet.ReadInt();
                    }
                    else if (type.Equals(typeof(string)))
                    {
                        args[i] = packet.ReadString();
                    }
                    else if (type.Equals(typeof(uint)))
                    {
                        args[i] = packet.ReadUInt();
                    }
                    else if (type.Equals(typeof(short)))
                    {
                        args[i] = packet.ReadShort();
                    }
                    else if (type.Equals(typeof(ushort)))
                    {
                        args[i] = packet.ReadUShort();
                    }
                    else if (type.Equals(typeof(byte)))
                    {
                        args[i] = packet.ReadByte();
                    }
                    else if (type.Equals(typeof(char)))
                    {
                        args[i] = packet.ReadChar();
                    }
                    else if (type.Equals(typeof(long)))
                    {
                        args[i] = packet.ReadLong();
                    }
                    else if (type.Equals(typeof(ulong)))
                    {
                        args[i] = packet.ReadULong();
                    }
                    else if (type.Equals(typeof(bool)))
                    {
                        args[i] = packet.ReadByte() != 0;
                    }
                    else if (type.IsEnum)
                    {
                        args[i] = packet.ReadInt();
                    }
                    else
                    {
                        if (!(args[i] is Action))
                        {
                            var text = packet.ReadBigString();
                            if (!string.IsNullOrEmpty(text))
                                args[i] = JsonConvert.DeserializeObject(text, type);
                        }
                    }
                }

                return args;
            }

            return null;
        }
    }
}