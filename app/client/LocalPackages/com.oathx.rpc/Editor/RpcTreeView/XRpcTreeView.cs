using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEditor.IMGUI.Controls;

namespace Oathx.Rpc.Editor
{
	public class XRpcTreeView<T> : TreeView where T : XRpcTreeElement
	{
#pragma warning disable IDE1006 // 命名样式
		/// <summary>
		/// 
		/// </summary>
		protected XRpcTreeModel<T> _treeModel;
		/// <summary>
		/// 
		/// </summary>
		protected readonly List<TreeViewItem> _rows = new List<TreeViewItem>(100);

        /// <summary>
        /// 
        /// </summary>

        public event Action treeChanged;

        /// <summary>
        /// 
        /// </summary>
        public XRpcTreeModel<T> treeModel 
		{
			get { return _treeModel; }
		}

		/// <summary>
		/// 
		/// </summary>
		public event Action<IList<TreeViewItem>> beforeDroppingDraggedItems;

		/// <summary>
		/// 
		/// </summary>
		/// <param name="state"></param>
		/// <param name="model"></param>
		public XRpcTreeView(TreeViewState state, XRpcTreeModel<T> model)
			: base(state)
		{
			Init(model);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="state"></param>
		/// <param name="multiColumnHeader"></param>
		/// <param name="model"></param>
		public XRpcTreeView(TreeViewState state, MultiColumnHeader multiColumnHeader, XRpcTreeModel<T> model)
			: base(state, multiColumnHeader)
		{
			Init(model);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="model"></param>
		private void Init(XRpcTreeModel<T> model)
		{
			_treeModel = model;
			_treeModel.modelChanged += ModelChanged;
		}

		/// <summary>
		/// 
		/// </summary>
		private void ModelChanged()
		{
			if (treeChanged != null)
				treeChanged();

			Reload();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <returns></returns>
		protected override TreeViewItem BuildRoot()
		{
			int depthForHiddenRoot = -1;
			return new XRpcTreeViewItem<T>(_treeModel.root.id, depthForHiddenRoot, _treeModel.root.name, _treeModel.root);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="root"></param>
		/// <returns></returns>
		protected override IList<TreeViewItem> BuildRows(TreeViewItem root)
		{
			if (_treeModel.root == null)
			{
				Debug.LogError("tree model root is null. did you call SetData()?");
			}

			_rows.Clear();
			if (!string.IsNullOrEmpty(searchString))
			{
				Search(_treeModel.root, searchString, _rows);
			}
			else
			{
				if (_treeModel.root.hasChildren)
					AddChildrenRecursive(_treeModel.root, 0, _rows);
			}

			// We still need to setup the child parent information for the rows since this 
			// information is used by the TreeView internal logic (navigation, dragging etc)
			SetupParentsAndChildrenFromDepths(root, _rows);

			return _rows;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="parent"></param>
		/// <param name="depth"></param>
		/// <param name="newRows"></param>
		private void AddChildrenRecursive(T parent, int depth, IList<TreeViewItem> newRows)
		{
			foreach (T child in parent.children)
			{
				var item = new XRpcTreeViewItem<T>(child.id, depth, child.name, child);
				newRows.Add(item);

				if (child.hasChildren)
				{
					if (IsExpanded(child.id))
					{
						AddChildrenRecursive(child, depth + 1, newRows);
					}
					else
					{
						item.children = CreateChildListForCollapsedParent();
					}
				}
			}
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="searchFromThis"></param>
		/// <param name="search"></param>
		/// <param name="result"></param>
		private void Search(T searchFromThis, string search, List<TreeViewItem> result)
		{
			if (string.IsNullOrEmpty(search))
				throw new ArgumentException("Invalid search: cannot be null or empty", "search");

			// tree is flattened when searching
			const int kItemDepth = 0; 

			Stack<T> stack = new Stack<T>();
			foreach (var element in searchFromThis.children)
				stack.Push((T)element);
			while (stack.Count > 0)
			{
				T current = stack.Pop();
				if (current.name.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0)
				{
					result.Add(new XRpcTreeViewItem<T>(current.id, kItemDepth, current.name, current));
				}

				if (current.children != null && current.children.Count > 0)
				{
					foreach (var element in current.children)
					{
						stack.Push((T)element);
					}
				}
			}

			SortSearchResult(result);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="rows"></param>
		protected virtual void SortSearchResult(List<TreeViewItem> rows)
		{
			// sort by displayName by default, can be overriden for multicolumn solutions
			rows.Sort((x, y) => EditorUtility.NaturalCompare(x.displayName, y.displayName)); 
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <returns></returns>
		protected override IList<int> GetAncestors(int id)
		{
			return _treeModel.GetAncestors(id);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="id"></param>
		/// <returns></returns>
		protected override IList<int> GetDescendantsThatHaveChildren(int id)
		{
			return _treeModel.GetDescendantsThatHaveChildren(id);
		}

		const string k_GenericDragID = "GenericDragColumnDragging";
		
		/// <summary>
		/// 
		/// </summary>
		/// <param name="args"></param>
		/// <returns></returns>
		protected override bool CanStartDrag(CanStartDragArgs args)
		{
			return false;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="args"></param>
		protected override void SetupDragAndDrop(SetupDragAndDropArgs args)
		{
			if (hasSearch)
				return;

			DragAndDrop.PrepareStartDrag();
			var draggedRows = GetRows().Where(item => args.draggedItemIDs.Contains(item.id)).ToList();
			DragAndDrop.SetGenericData(k_GenericDragID, draggedRows);
			// this IS required for dragging to work
			DragAndDrop.objectReferences = new UnityEngine.Object[] { }; 
			string title = draggedRows.Count == 1 ? draggedRows[0].displayName : "< Multiple >";
			DragAndDrop.StartDrag(title);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="args"></param>
		/// <returns></returns>
		protected override DragAndDropVisualMode HandleDragAndDrop(DragAndDropArgs args)
		{
			// Check if we can handle the current drag data (could be dragged in from other areas/windows in the editor)
			var draggedRows = DragAndDrop.GetGenericData(k_GenericDragID) as List<TreeViewItem>;
			if (draggedRows == null)
				return DragAndDropVisualMode.None;

			// Parent item is null when dragging outside any tree view items.
			switch (args.dragAndDropPosition)
			{
				case DragAndDropPosition.UponItem:
				case DragAndDropPosition.BetweenItems:
					{
						bool validDrag = ValidDrag(args.parentItem, draggedRows);
						if (args.performDrop && validDrag)
						{
							T parentData = ((XRpcTreeViewItem<T>)args.parentItem).data;
							OnDropDraggedElementsAtIndex(draggedRows, parentData, args.insertAtIndex == -1 ? 0 : args.insertAtIndex);
						}
						return validDrag ? DragAndDropVisualMode.Move : DragAndDropVisualMode.None;
					}

				case DragAndDropPosition.OutsideItems:
					{
						if (args.performDrop)
							OnDropDraggedElementsAtIndex(draggedRows, _treeModel.root, _treeModel.root.children.Count);

						return DragAndDropVisualMode.Move;
					}
				default:
					Debug.LogError("Unhandled enum " + args.dragAndDropPosition);
					return DragAndDropVisualMode.None;
			}
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="draggedRows"></param>
		/// <param name="parent"></param>
		/// <param name="insertIndex"></param>
		public virtual void OnDropDraggedElementsAtIndex(List<TreeViewItem> draggedRows, T parent, int insertIndex)
		{
			if (beforeDroppingDraggedItems != null)
				beforeDroppingDraggedItems(draggedRows);

			var draggedElements = new List<XRpcTreeElement>();
			foreach (var x in draggedRows)
				draggedElements.Add(((XRpcTreeViewItem<T>)x).data);

			var selectedIDs = draggedElements.Select(x => x.id).ToArray();
			_treeModel.MoveElements(parent, insertIndex, draggedElements);
			SetSelection(selectedIDs, TreeViewSelectionOptions.RevealAndFrame);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="parent"></param>
		/// <param name="draggedItems"></param>
		/// <returns></returns>
		private bool ValidDrag(TreeViewItem parent, List<TreeViewItem> draggedItems)
		{
			TreeViewItem currentParent = parent;
			while (currentParent != null)
			{
				if (draggedItems.Contains(currentParent))
					return false;
				currentParent = currentParent.parent;
			}
			return true;
		}
#pragma warning restore IDE1006 // 命名样式
	}
}
