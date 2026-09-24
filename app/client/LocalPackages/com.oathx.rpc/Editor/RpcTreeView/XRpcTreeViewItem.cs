using System;
using System.Collections.Generic;
using UnityEditor.IMGUI.Controls;
using UnityEngine;

namespace Oathx.Rpc.Editor
{

	[Serializable]
	public class XRpcTreeElement
	{
		[SerializeField] int		_id;
		[SerializeField] string		_name;
		[SerializeField] int		_depth;

		[NonSerialized] 
		private XRpcTreeElement		_parent;
		[NonSerialized]
		private List<XRpcTreeElement> _children;

		/// <summary>
		/// 
		/// </summary>
		public XRpcTreeElement()
		{
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="name"></param>
		/// <param name="depth"></param>
		/// <param name="id"></param>
		public XRpcTreeElement(string name, int depth, int id)
		{
			_name = name;
			_id = id;
			_depth = depth;
		}

		/// <summary>
		/// 
		/// </summary>
		public int depth
		{
			get { return _depth; }
			set { _depth = value; }
		}

		/// <summary>
		/// 
		/// </summary>
		public XRpcTreeElement parent
		{
			get { return _parent; }
			set { _parent = value; }
		}

		/// <summary>
		/// 
		/// </summary>
		public List<XRpcTreeElement> children
		{
			get { return _children; }
			set { _children = value; }
		}

		/// <summary>
		/// 
		/// </summary>
		public bool hasChildren
		{
			get { return children != null && children.Count > 0; }
		}

		/// <summary>
		/// 
		/// </summary>
		public string name
		{
			get { return _name; }
			set { _name = value; }
		}

		/// <summary>
		/// 
		/// </summary>
		public int id
		{
			get { return _id; }
			set { _id = value; }
		}
	}


	/// <summary>
	/// 
	/// </summary>
	/// <typeparam name="T"></typeparam>
	public class XRpcTreeViewItem<T> : TreeViewItem where T : XRpcTreeElement
	{
		/// <summary>
		/// 
		/// </summary>
		public T data 
		{ get; set; }

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <param name="depth"></param>
		/// <param name="displayName"></param>
		/// <param name="data"></param>
		public XRpcTreeViewItem(int id, int depth, string displayName, T data)
			: base(id, depth, displayName)
		{
			this.data = data;
		}
	}

}
