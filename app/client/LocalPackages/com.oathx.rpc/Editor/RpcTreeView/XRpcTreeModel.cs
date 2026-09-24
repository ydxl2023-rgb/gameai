using System;
using System.Linq;
using System.Collections.Generic;

namespace Oathx.Rpc.Editor
{
	/// <summary>
	/// 
	/// </summary>
	/// <typeparam name="T"></typeparam>
	public class XRpcTreeModel<T> where T : XRpcTreeElement
	{
		private IList<T> _data;
		private T _root;
		private int _maxId;

		/// <summary>
		/// 
		/// </summary>
		public T root
		{
			get { return _root; }
			set { _root = value; }
		}

		/// <summary>
		/// 
		/// </summary>
		public event Action modelChanged;

		/// <summary>
		/// 
		/// </summary>
		public int numberOfDataElements
		{
			get { return _data.Count; }
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="data"></param>
		public XRpcTreeModel(IList<T> data)
		{
			SetData(data);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <returns></returns>
		public T Find(int id)
		{
			return _data.FirstOrDefault(element => element.id == id);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="data"></param>
		public void SetData(IList<T> data)
		{
			Init(data);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="data"></param>
		private void Init(IList<T> data)
		{
			if (data == null)
				throw new ArgumentNullException("data", "Input data is null. Ensure input is a non-null list.");

			_data = data;
			if (_data.Count > 0)
				_root = XRpcTreeUtility.ListToTree(data);

			_maxId = _data.Max(e => e.id);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <returns></returns>
		public int GenerateUniqueID()
		{
			return ++_maxId;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <returns></returns>
		public IList<int> GetAncestors(int id)
		{
			var parents = new List<int>();

			XRpcTreeElement T = Find(id);
			if (T != null)
			{
				while (T.parent != null)
				{
					parents.Add(T.parent.id);
					T = T.parent;
				}
			}

			return parents;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <returns></returns>
		public IList<int> GetDescendantsThatHaveChildren(int id)
		{
			T searchFromThis = Find(id);
			if (searchFromThis != null)
			{
				return GetParentsBelowStackBased(searchFromThis);
			}

			return new List<int>();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="searchFromThis"></param>
		/// <returns></returns>
		private IList<int> GetParentsBelowStackBased(XRpcTreeElement searchFromThis)
		{
			Stack<XRpcTreeElement> stack = new Stack<XRpcTreeElement>();
			stack.Push(searchFromThis);

			var parentsBelow = new List<int>();
			while (stack.Count > 0)
			{
				XRpcTreeElement current = stack.Pop();
				if (current.hasChildren)
				{
					parentsBelow.Add(current.id);
					foreach (var T in current.children)
					{
						stack.Push(T);
					}
				}
			}

			return parentsBelow;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="elementIDs"></param>
		public void RemoveElements(IList<int> elementIDs)
		{
			IList<T> elements = _data.Where(element => elementIDs.Contains(element.id)).ToArray();
			RemoveElements(elements);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="elements"></param>
		public void RemoveElements(IList<T> elements)
		{
			foreach (var element in elements)
				if (element == _root)
					throw new ArgumentException("It is not allowed to remove the root element");

			var commonAncestors = XRpcTreeUtility.FindCommonAncestorsWithinList(elements);
			foreach (var element in commonAncestors)
			{
				element.parent.children.Remove(element);
				element.parent = null;
			}

			XRpcTreeUtility.TreeToList(_root, _data);

			Changed();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="elements"></param>
		/// <param name="parent"></param>
		/// <param name="insertPosition"></param>
		public void AddElements(IList<T> elements, XRpcTreeElement parent, int insertPosition)
		{
			if (elements == null)
				throw new ArgumentNullException("elements", "elements is null");
			if (elements.Count == 0)
				throw new ArgumentNullException("elements", "elements Count is 0: nothing to add");
			if (parent == null)
				throw new ArgumentNullException("parent", "parent is null");

			if (parent.children == null)
				parent.children = new List<XRpcTreeElement>();

			parent.children.InsertRange(insertPosition, elements.Cast<XRpcTreeElement>());
			foreach (var element in elements)
			{
				element.parent = parent;
				element.depth = parent.depth + 1;
				XRpcTreeUtility.UpdateDepthValues(element);
			}

			XRpcTreeUtility.TreeToList(_root, _data);

			Changed();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="root"></param>
		public void AddRoot(T root)
		{
			if (root == null)
				throw new ArgumentNullException("root", "root is null");

			if (_data == null)
				throw new InvalidOperationException("Internal Error: data list is null");

			if (_data.Count != 0)
				throw new InvalidOperationException("AddRoot is only allowed on empty data list");

			root.id = GenerateUniqueID();
			root.depth = -1;
			_data.Add(root);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="element"></param>
		/// <param name="parent"></param>
		/// <param name="insertPosition"></param>
		public void AddElement(T element, XRpcTreeElement parent, int insertPosition)
		{
			if (element == null)
				throw new ArgumentNullException("element", "element is null");
			if (parent == null)
				throw new ArgumentNullException("parent", "parent is null");

			if (parent.children == null)
				parent.children = new List<XRpcTreeElement>();

			parent.children.Insert(insertPosition, element);
			element.parent = parent;

			XRpcTreeUtility.UpdateDepthValues(parent);
			XRpcTreeUtility.TreeToList(_root, _data);

			Changed();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="parentElement"></param>
		/// <param name="insertionIndex"></param>
		/// <param name="elements"></param>
		public void MoveElements(XRpcTreeElement parentElement, int insertionIndex, List<XRpcTreeElement> elements)
		{
			if (insertionIndex < 0)
            {
				throw new ArgumentException("Invalid input: insertionIndex is -1, " +
					"client needs to decide what index elements should be reparented at");
			}
				
			// Invalid reparenting input
			if (parentElement == null)
				return;

			// We are moving items so we adjust the insertion index to accomodate
			// that any items above the insertion index is removed before inserting
			if (insertionIndex > 0)
				insertionIndex -= parentElement.children.GetRange(0, insertionIndex).Count(elements.Contains);

			// Remove draggedItems from their parents
			foreach (var draggedItem in elements)
			{
				// remove from old parent
				draggedItem.parent.children.Remove(draggedItem);
				// set new parent
				draggedItem.parent = parentElement;               
			}

			if (parentElement.children == null)
				parentElement.children = new List<XRpcTreeElement>();

			// Insert dragged items under new parent
			parentElement.children.InsertRange(insertionIndex, elements);

			XRpcTreeUtility.UpdateDepthValues(root);
			XRpcTreeUtility.TreeToList(_root, _data);

			Changed();
		}

		/// <summary>
		/// 
		/// </summary>
		void Changed()
		{
			if (modelChanged != null)
				modelChanged();
		}
	}

}
