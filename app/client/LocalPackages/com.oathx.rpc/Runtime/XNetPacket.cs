using System;
using System.Collections.Generic;
using System.Net;
using UnityEngine;

namespace Oathx.Rpc
{
    /// <summary>
    /// net packet class
    /// </summary>
    public class XNetPacket
    {
        public const int BufferSize = 4096;

        protected int size = 0;
        protected int type = 0;
        protected bool storing = false;
        protected byte[] data = null;
        protected int offset = 0;
        protected uint sn = 0;
        protected int flags = 0;

        /// <summary>
        /// construct
        /// </summary>
        public XNetPacket()
        {

        }

        /// <summary>
        /// construct with flags
        /// </summary>
        /// <param name="nFlags"></param>
        public XNetPacket(int nFlags)
        {
            flags = nFlags;
        }

        /// <summary>
        /// construct with packet type and flags
        /// </summary>
        /// <param name="packetType"></param>
        /// <param name="nFlags"></param>
        public XNetPacket(int packetType, int nFlags)
        {
            type = packetType;
            data = new byte[BufferSize];
            storing = true;
            offset = sizeof(int) * 2;
            size = sizeof(int);
            flags = nFlags;
        }

        /// <summary>
        /// construct with packet type, serial number and flags
        /// </summary>
        /// <param name="packetType"></param>
        /// <param name="serialNum"></param>
        /// <param name="nFlags"></param>
        public XNetPacket(int packetType, uint serialNum, int nFlags)
        {
            type = packetType;
            data = new byte[BufferSize];
            storing = true;
            offset = sizeof(int) * 3;
            size = sizeof(int) * 2;
            sn = serialNum;
            flags = nFlags;
        }

        /// <summary>
        /// construct with raw buffer
        /// </summary>
        /// <param name="buffer"></param>
        /// <param name="len"></param>
        /// <param name="nFlags"></param>
        public XNetPacket(byte[] buffer, int len = 0, int nFlags=0)
        {
            flags = nFlags;
            SetRaw(buffer, len);
        }

        /// <summary>
        /// packet flags
        /// </summary>
        public int Flags {
            get { return flags; }
            set {
                flags = value;
            }
        }

        /// <summary>
        /// packet size
        /// </summary>
        public int Size
        {
            get { return size; }

            internal set
            {
                size = value;
            }
        }

        /// <summary>
        /// real packet size including header
        /// </summary>
        public int RealSize
        {
            get { return size + sizeof(int); }
        }

        /// <summary>
        /// packet type
        /// </summary>
        public int Type
        {
            get { return type; }
            internal set { type = value; }
        }

        /// <summary>
        /// storing flag
        /// </summary>
        public bool Storing
        {
            get { return storing; }
            internal set { storing = value; }
        }

        /// <summary>
        /// current offset
        /// </summary>
        public int Offset
        {
            get { return offset; }
            internal set { offset = value; }
        }

        /// <summary>
        /// packet serial number
        /// </summary>
        public uint Timestamp
        {
            get;
            internal set;
        }

        /// <summary>
        /// set packet type
        /// </summary>
        /// <param name="newType"></param>
        public void SetType(int newType)
        {
            type = newType;
        }

        /// <summary>
        /// get packet raw bytes
        /// </summary>
        /// <returns></returns>
        public byte[] GetBytes()
        {
            return data;
        }

        /// <summary>
        /// reset read/write offset
        /// </summary>
        public void ResetOffset()
        {
            offset = sizeof(int) * 2;
        }

        /// <summary>
        /// set packet data from raw buffer
        /// </summary>
        /// <param name="packetSize"></param>
        /// <param name="buffer"></param>
        /// <param name="start"></param>
        public void Set(int packetSize, byte[] buffer, int start)
        {
            size = packetSize;
            type = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(buffer, start));

            data = new byte[size];
            Buffer.BlockCopy(buffer, start, data, 0, size);
            offset = sizeof(int);

            Timestamp = XNetUtility.Iclock();
        }

        /// <summary>
        /// set packet data from raw buffer with type size offset
        /// </summary>
        /// <param name="packetSize"></param>
        /// <param name="buffer"></param>
        /// <param name="startOffset"></param>
        /// <param name="typeSize"></param>
        public void Set(int packetSize, byte[] buffer, int startOffset, int typeSize)
        {
            size = packetSize;
            type = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(buffer, typeSize));

            data = new byte[size];
            Buffer.BlockCopy(buffer, startOffset, data, 0, size);
            offset = sizeof(int);

            Timestamp = XNetUtility.Iclock();
        }

        /// <summary>
        /// set packet data from raw buffer
        /// </summary>
        /// <param name="buffer"></param>
        /// <param name="len"></param>
        public void SetRaw(byte[] buffer, int len)
        {
            if (len > 0)
            {
                size = len - sizeof(int);
                type = 0;
            }
            else
            {
                size = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(buffer, 0));
                type = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(buffer, sizeof(int)));
            }

            data = buffer;
            offset = sizeof(int) * 2;

            Timestamp = XNetUtility.Iclock();
        }

        /// <summary>
        /// fill binary data
        /// </summary>
        /// <param name="buffer"></param>
        public void FillBrinaryData(byte[] buffer)
        {
            if (buffer.Length > 0)
            {
                size = buffer.Length;
                type = int.MinValue;

                data = new byte[size];
                Buffer.BlockCopy(buffer, 0, data, 0, size);
                offset = 0;

                Timestamp = XNetUtility.Iclock();
            }
        }

        /// <summary>
        /// read char from packet
        /// </summary>
        /// <returns></returns>
        public char ReadChar()
        {
            if (offset >= data.Length)
                return '0';

            char value = (char)data[offset];
            offset++;

            return value;
        }

        /// <summary>
        /// read byte from packet
        /// </summary>
        /// <returns></returns>
        public byte ReadByte()
        {
            if (offset >= data.Length)
                return 0;

            byte value = data[offset];
            offset++;

            return value;
        }

        /// <summary>
        /// read short from packet
        /// </summary>
        /// <returns></returns>
        public short ReadShort()
        {
            if (offset >= data.Length)
                return 0;

            short value = BitConverter.ToInt16(data, offset);
            offset += sizeof(short);

            return IPAddress.NetworkToHostOrder(value);
        }

        /// <summary>
        /// read ushort from packet
        /// </summary>
        /// <returns></returns>
        public ushort ReadUShort()
        {
            return unchecked((ushort)ReadShort());
        }

        /// <summary>
        /// read int from packet
        /// </summary>
        /// <returns></returns>
        public int ReadInt()
        {
            if (offset >= data.Length)
                return 0;

            int value = BitConverter.ToInt32(data, offset);
            offset += sizeof(int);

            return IPAddress.NetworkToHostOrder(value);
        }

        /// <summary>
        /// read uint from packet
        /// </summary>
        /// <returns></returns>
        public uint ReadUInt()
        {
            return unchecked((uint)ReadInt());
        }

        /// <summary>
        /// read string from packet
        /// </summary>
        /// <returns></returns>
        public string ReadString()
        {
            ushort len = ReadUShort();
            if (offset + len > data.Length)
                return "";

            string str = System.Text.Encoding.UTF8.GetString(data, offset, len);
            offset += len;

            return str;
        }

        /// <summary>
        /// read big string from packet
        /// </summary>
        /// <returns></returns>
        public string ReadBigString()
        {
            int len = ReadInt();
            if (len < 0 || offset + len > data.Length)
                return "";

            string str = System.Text.Encoding.UTF8.GetString(data, offset, len);
            offset += len;

            return str;
        }

        /// <summary>
        /// read bytes from packet
        /// </summary>
        /// <param name="len"></param>
        /// <returns></returns>
        public byte[] ReadBytes(int len)
        {
            if (offset + len > data.Length)
                return null;

            byte[] buffer = new byte[len];
            Buffer.BlockCopy(data, offset, buffer, 0, len);
            offset += len;

            return buffer;
        }

        /// <summary>
        /// read block from packet
        /// </summary>
        /// <returns></returns>
        public byte[] ReadBlock()
        {
            if (offset >= data.Length)
                return null;

            int len = ReadInt();
            return ReadBytes(len);
        }

        /// <summary>
        /// read float from packet
        /// </summary>
        /// <returns></returns>
        public float ReadFloat()
        {
            if (offset >= data.Length)
                return .0f;

            float value = BitConverter.ToSingle(data, offset);
            offset += sizeof(float);

            return value;
        }

        /// <summary>
        /// write char to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteChar(char value)
        {
            if (!storing)
                return false;

            data[offset] = (byte)value;
            offset++;
            size++;

            return true;
        }

        /// <summary>
        /// write byte to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteByte(byte value)
        {
            if (!storing)
                return false;

            data[offset] = value;
            offset++;
            size++;

            return true;
        }

        /// <summary>
        /// write short to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteShort(short value)
        {
            if (!storing)
                return false;

            value = IPAddress.HostToNetworkOrder(value);
            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, offset, bytes.Length);
            offset += bytes.Length;
            size += bytes.Length;

            return true;
        }

        /// <summary>
        /// write ushort to packet
        /// </summary>
        /// <param name="value"></param>
        public void WriteUShort(ushort value)
        {
            WriteShort(unchecked((short)value));
        }

        /// <summary>
        /// write int to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteInt(int value)
        {
            if (!storing)
                return false;

            value = IPAddress.HostToNetworkOrder(value);

            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, offset, bytes.Length);
            offset += bytes.Length;
            size += bytes.Length;

            return true;
        }

        /// <summary>
        /// write uint to packet
        /// </summary>
        /// <param name="value"></param>
        public void WriteUInt(uint value)
        {
            WriteInt(unchecked((int)value));
        }

        /// <summary>
        /// write string to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteString(string value)
        {
            if (!storing)
                return false;

            if (value.Length > UInt16.MaxValue)
                return false;

            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(value);

            ushort len = (ushort)bytes.Length;
            WriteUShort(len);

            Buffer.BlockCopy(bytes, 0, data, offset, len);
            offset += len;
            size += len;

            return true;
        }

        /// <summary>
        /// write big string to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteBigString(string value)
        {
            if (!storing)
                return false;

            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(value);

            int len = bytes.Length;
            WriteInt(len);

            Buffer.BlockCopy(bytes, 0, data, offset, len);
            offset += len;
            size += len;

            return true;
        }

        /// <summary>
        /// write bytes to packet
        /// </summary>
        /// <param name="buffer"></param>
        /// <returns></returns>
        public bool WriteBytes(byte[] buffer)
        {
            if (!storing)
                return false;

            int len = buffer.Length;
            Buffer.BlockCopy(buffer, 0, data, offset, len);

            offset += len;
            size += len;

            return true;
        }

        /// <summary>
        /// write bytes to packet with length
        /// </summary>
        /// <param name="buffer"></param>
        /// <param name="nLength"></param>
        /// <returns></returns>
        public bool WriteBytes(byte[] buffer, int nLength)
        {
            if (!storing)
                return false;

            int len = nLength;
            Buffer.BlockCopy(buffer, 0, data, offset, len);

            offset += len;
            size += len;

            return true;
        }

        /// <summary>
        /// write block to packet
        /// </summary>
        /// <param name="buffer"></param>
        public void WriteBlock(byte[] buffer)
        {
            WriteInt(buffer.Length);
            WriteBytes(buffer);
        }

        /// <summary>
        /// write float to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteFloat(float value)
        {
            if (!storing)
                return false;

            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, offset, bytes.Length);

            offset += bytes.Length;
            size += bytes.Length;

            return true;
        }

        /// <summary>
        /// write json object to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteJsonObject(object value)
        {
            string json = LitJson.JsonMapper.ToJson(value);
            WriteBigString(json);

            return true;
        }

        /// <summary>
        /// read json object from packet
        /// </summary>
        /// <returns></returns>
        public object ReadJsonObject()
        {
            string bigString = ReadBigString();
            return LitJson.JsonMapper.ToObject(bigString);
        }

        /// <summary>
        /// write long to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteLong(long value)
        {
            if (!storing)
                return false;

            value = IPAddress.HostToNetworkOrder(value);

            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, offset, bytes.Length);
            offset += bytes.Length;
            size += bytes.Length;

            return true;
        }

        /// <summary>
        /// read long from packet
        /// </summary>
        /// <returns></returns>
        public long ReadLong()
        {
            if (offset >= data.Length)
                return 0;

            long value = BitConverter.ToInt64(data, offset);
            offset += sizeof(long);

            return IPAddress.NetworkToHostOrder(value);
        }

        /// <summary>
        /// write ulong to packet
        /// </summary>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool WriteULong(ulong value)
        {
            WriteLong(unchecked((long)value));
            return true;
        }

        /// <summary>
        /// read ulong from packet
        /// </summary>
        /// <returns></returns>
        public ulong ReadULong()
        {
            return unchecked((ulong)ReadLong());
        }

        /// <summary>
        /// push int at position
        /// </summary>
        /// <param name="pos"></param>
        /// <param name="value"></param>
        /// <returns></returns>
        public bool PushIntAt(int pos, int value)
        {
            if (!storing)
                return false;

            value = IPAddress.HostToNetworkOrder(value);
            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, pos, bytes.Length);

            return true;
        }

        /// <summary>
        /// finish packet
        /// </summary>
        public void Finish()
        {
            Finish(sn);
        }

        /// <summary>
        /// finish packet with serial number
        /// </summary>
        /// <param name="serialNum"></param>
        /// <returns></returns>
        public bool Finish(uint serialNum)
        {
            if (!storing)
                return false;

            int dstOffset = 0;
            int value = IPAddress.HostToNetworkOrder(size);
            byte[] bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, dstOffset, sizeof(int));
            dstOffset += sizeof(int);

            sn = serialNum;
            if (sn != 0)
            {
                value = IPAddress.HostToNetworkOrder(unchecked((int)sn));
                bytes = BitConverter.GetBytes(value);
                Buffer.BlockCopy(bytes, 0, data, dstOffset, sizeof(int));
                dstOffset += sizeof(int);
            }

            value = IPAddress.HostToNetworkOrder(type);
            bytes = BitConverter.GetBytes(value);
            Buffer.BlockCopy(bytes, 0, data, dstOffset, sizeof(int));

            Timestamp = XNetUtility.Iclock();

#if UNITY_EDITOR || !UNITY_RELEASE
            Debug.Log(string.Format("[Packet.Finish] packet {0} finished with size:{1}", type, size));
#endif

            ResetOffset();
            return true;
        }

        /// <summary>
        /// compare two packets
        /// </summary>
        /// <param name="other"></param>
        /// <returns></returns>
        public bool Equals(XNetPacket other)
        {
            if (size == other.Size)
            {
                byte[] otherData = other.GetBytes();
                for (int i = 0; i < size; i++)
                {
                    if (data[i] != otherData[i])
                        return false;
                }
                return true;
            }

            return false;
        }

        /// <summary>
        /// to string
        /// </summary>
        /// <returns></returns>
        public override string ToString()
        {
            return string.Format("Type {0} size {1} offset {2} sn {3}", type, size, offset, sn);
        }
    }

    /// <summary>
    /// simple net packet pool
    /// </summary>
    public static class XNetPacketPool
    {
        /// <summary>
        /// cache packet queue
        /// </summary>
        private static readonly Queue<XNetPacket> packets = new Queue<XNetPacket>();

        /// <summary>
        /// alloc net packet
        /// </summary>
        /// <returns></returns>
        public static XNetPacket Alloc(XRpcType sessionType)
        {
            int flags = (int)sessionType;
            lock (packets)
            {
                if (packets.Count > 0)
                {
                    var packet = packets.Dequeue();
                    packet.Flags = flags;

                    return packet;
                }
            }
            
            return new XNetPacket(flags);
        }

        /// <summary>
        /// alloc net packet
        /// </summary>
        /// <param name="packetType"></param>
        /// <returns></returns>
        public static XNetPacket Alloc(XRpcType sessionType, int packetType)
        {
            int flags = (int)sessionType;
            lock(packets)
            {
                if (packets.Count > 0)
                {
                    var packet = packets.Dequeue();

                    packet.Type = packetType;
                    packet.Storing = true;
                    packet.Offset = sizeof(int) * 2;
                    packet.Size = sizeof(int);
                    packet.Flags = flags;
                }
            }

            return new XNetPacket(packetType, flags);
        }

        /// <summary>
        /// recycle net packet, reset the packet to default state
        /// </summary>
        /// <param name="packet"></param>
        /// <returns></returns>
        public static void Recycle(XNetPacket packet)
        {
            if (packet != null)
            {
                lock (packets)
                {
                    packet.Size = 0;
                    packet.Type = 0;
                    packet.Offset = 0;
                    packet.Storing = false;
                    packet.Timestamp = 0;
                    packet.Flags = 0;

                    packets.Enqueue(packet);
                }
            }
        }
    }
}
