using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Assertions;
using UnityEditor;
using UnityEditor.IMGUI.Controls;
using System.Text;

namespace Oathx.Rpc.Editor
{
	/// <summary>
	/// 
	/// </summary>
	public class XRpcTreeView : XRpcTreeView<XRpcEditorMethod>
	{
		const float kRowHeights = 20f;
		const float kToggleWidth = 18f;
		public bool showControls = true;

		private Dictionary<int, RowGUIArgs> cahceRows = new Dictionary<int, RowGUIArgs>();
		// All columns
		enum HttpColumns
		{
			Flag,
			Type,
			Name,
			Hash,
			Send,
			Recv,
			Ping,
			Call,
			Delay,
		}

		public enum SortOption
		{
			Flag,
			Type,
			Name,
			Hash,
			Send,
			Recv,
			Ping,
			Call,
			Delay,			
		}

		// Sort options per column
		SortOption[] sortOptions =
		{
			SortOption.Flag,
			SortOption.Type,
			SortOption.Name,
			SortOption.Hash,
			SortOption.Send,
			SortOption.Recv,
			SortOption.Ping,
			SortOption.Call,
			SortOption.Delay,
		};

		/// <summary>
		/// 
		/// </summary>
		/// <param name="state"></param>
		/// <param name="multicolumnHeader"></param>
		/// <param name="model"></param>
		public XRpcTreeView(TreeViewState state, MultiColumnHeader multicolumnHeader, XRpcTreeModel<XRpcEditorMethod> model)
			: base(state, multicolumnHeader, model)
		{
			// Custom setup
			rowHeight = kRowHeights;
			columnIndexForTreeFoldouts = 2;
			showAlternatingRowBackgrounds = true;
			showBorder = true;

			// center foldout in the row since we also center content. See RowGUI
			customFoldoutYOffset = (kRowHeights - EditorGUIUtility.singleLineHeight) * 0.5f;
			extraSpaceBeforeIconAndLabel = kToggleWidth;

			multicolumnHeader.sortedColumnIndex = (int)SortOption.Name;
			multicolumnHeader.sortingChanged += OnSortingChanged;

			Reload();
		}

		/// <summary>
		/// Note we We only build the visible rows, only the backend has the full tree information. 
		/// The treeview only creates info for the row list.
		/// </summary>
		/// <param name="root"></param>
		/// <returns></returns>
		protected override IList<TreeViewItem> BuildRows(TreeViewItem root)
		{
			var rows = base.BuildRows(root);
			SortIfNeeded(root, rows);

			return rows;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="multiColumnHeader"></param>
		private void OnSortingChanged(MultiColumnHeader multiColumnHeader)
		{
			SortIfNeeded(rootItem, GetRows());
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="root"></param>
		/// <param name="rows"></param>
		private bool SortIfNeeded(TreeViewItem root, IList<TreeViewItem> rows)
		{
			// No column to sort for (just use the order the data are in)
			if (rows.Count <= 1 || multiColumnHeader.sortedColumnIndex == -1)
				return false;

			// Sort the roots of the existing tree items
			SortByMultipleColumns();
			TreeToList(root, rows);

			// force repaint
			Repaint();
			return true;
		}

		/// <summary>
		/// 
		/// </summary>
		private void SortByMultipleColumns()
		{
			var sortedColumns = multiColumnHeader.state.sortedColumns;
			if (sortedColumns.Length == 0)
				return;

			var methodType = rootItem.children.Cast<XRpcTreeViewItem<XRpcEditorMethod>>();

			var orderedQuery = InitialOrder(methodType, sortedColumns);
			for (int i = 1; i < sortedColumns.Length; i++)
			{
				SortOption sortOption = sortOptions[sortedColumns[i]];
				bool ascending = multiColumnHeader.IsSortedAscending(sortedColumns[i]);

				switch (sortOption)
				{
					case SortOption.Flag:
						orderedQuery = orderedQuery.ThenBy(l => l.data.flag, ascending);
						break;
					case SortOption.Type:
						orderedQuery = orderedQuery.ThenBy(l => l.data.type, ascending);
						break;
					case SortOption.Name:
						orderedQuery = orderedQuery.ThenBy(l => l.data.name, ascending);
						break;
					case SortOption.Ping:
						orderedQuery = orderedQuery.ThenBy(l => l.data.ping, ascending);
						break;
					case SortOption.Send:
						orderedQuery = orderedQuery.ThenBy(l => l.data.call, ascending);
						break;
					case SortOption.Recv:
						orderedQuery = orderedQuery.ThenBy(l => l.data.send, ascending);
						break;
					case SortOption.Call:
						orderedQuery = orderedQuery.ThenBy(l => l.data.recv, ascending);
						break;
					case SortOption.Delay:
						orderedQuery = orderedQuery.ThenBy(l => l.data.delay, ascending);
						break;
				}
			}

			rootItem.children = orderedQuery.Cast<TreeViewItem>().ToList();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="method"></param>
		/// <param name="history"></param>
		/// <returns></returns>
		IOrderedEnumerable<XRpcTreeViewItem<XRpcEditorMethod>> InitialOrder(IEnumerable<XRpcTreeViewItem<XRpcEditorMethod>> method, int[] history)
		{
			SortOption sortOption = sortOptions[history[0]];
			bool ascending = multiColumnHeader.IsSortedAscending(history[0]);
			switch (sortOption)
			{
				case SortOption.Flag:
					return method.Order(l => l.data.flag, ascending);
				case SortOption.Type:
					return method.Order(l => l.data.type, ascending);
				case SortOption.Name:
					return method.Order(l => l.data.name, ascending);
				case SortOption.Hash:
					return method.Order(l => l.data.hash, ascending);
				case SortOption.Send:
					return method.Order(l => l.data.send, ascending);
				case SortOption.Recv:
					return method.Order(l => l.data.recv, ascending);
				case SortOption.Ping:
					return method.Order(l => l.data.ping, ascending);
				case SortOption.Call:
					return method.Order(l => l.data.call, ascending);
				case SortOption.Delay:
					return method.Order(l => l.data.delay, ascending);
				default:
					Assert.IsTrue(false, $"Unhandled enum {sortOption}");
					break;
			}

			return method.Order(l => l.data.name, ascending);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="args"></param>
		protected override void RowGUI(RowGUIArgs args)
		{
			var item = (XRpcTreeViewItem<XRpcEditorMethod>)args.item;

			for (int i = 0; i < args.GetNumVisibleColumns(); ++i)
			{
				CellGUI(args.GetCellRect(i), item, (HttpColumns)args.GetColumn(i), ref args);
			}

			if (!cahceRows.ContainsKey(args.row))
				cahceRows.Add(args.row, args);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="cellRect"></param>
		/// <param name="item"></param>
		/// <param name="column"></param>
		/// <param name="args"></param>
		private void CellGUI(Rect cellRect, XRpcTreeViewItem<XRpcEditorMethod> item, HttpColumns column, ref RowGUIArgs args)
		{
			// Center cell rect vertically (makes it easier to place controls, icons etc in the cells)
			CenterRectUsingSingleLineHeight(ref cellRect);

			if (item.data.flag != 0)
            {
				GUI.color = Color.cyan;
			}
			else if (item.data.send > item.data.recv)
			{
				GUI.color = Color.yellow;
			}
			else if (item.data.onlySend)
            {
				GUI.color = Color.green * 0.7f;
			}
			else 
			{
				GUI.color = item.data.enabled ? Color.white : Color.gray;
			}	

			switch (column)
			{
				case HttpColumns.Flag:
					GUI.Label(cellRect, item.data.flag.ToString());
					break;
				case HttpColumns.Type:
					GUI.Label(cellRect, item.data.type.ToString());
					break;

				case HttpColumns.Name:
					{
						args.label = item.data.displayName;

						Rect toggleRect = cellRect;
						toggleRect.x += GetContentIndent(item);
						toggleRect.width = kToggleWidth;
						if (toggleRect.xMax < cellRect.xMax)
							item.data.enabled = EditorGUI.Toggle(toggleRect, item.data.enabled);

						var name = XNetRpc.GetProtocolNameByHash(item.data.hash);
						if (XNetAnalytics.TryGetMethod(item.data.type, name, out var method))
							method.enabled = item.data.enabled;

						args.rowRect = cellRect;
						base.RowGUI(args);
					}
					break;

				case HttpColumns.Hash:
					GUI.Label(cellRect, item.data.hash.ToString());
					break;
				case HttpColumns.Send:
					GUI.Label(cellRect, item.data.send.ToString());
					break;
				case HttpColumns.Recv:
					GUI.Label(cellRect, item.data.recv.ToString());
					break;
				case HttpColumns.Ping:
					GUI.Label(cellRect, item.data.ping.ToString());
					break;
				case HttpColumns.Call:
					GUI.Label(cellRect, item.data.call.ToString());
					break;
				case HttpColumns.Delay:
					item.data.delay = (long)GUI.HorizontalSlider(cellRect, item.data.delay, 0, 1000);

					if (XNetAnalytics.TryGetMethod(item.data.type, XNetRpc.GetProtocolNameByHash(item.data.hash), out var delayMehtod))
						delayMehtod.delay = item.data.delay;
					break;
			}

			GUI.color = Color.white;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="rect"></param>
		public override void OnGUI(Rect rect)
		{
			cahceRows.Clear();
			base.OnGUI(rect);

			XRpcTreeViewItem<XRpcEditorMethod> tooltip = null;
			Rect rightRect = new Rect();

			foreach (var v in cahceRows)
			{
				var rowRect = v.Value.rowRect;
				var curRect = new Rect(rowRect.x, rowRect.y + 60, rowRect.width, rowRect.height);
				if (curRect.Contains(Event.current.mousePosition))
				{
					tooltip = v.Value.item as XRpcTreeViewItem<XRpcEditorMethod>;
					rightRect = curRect;
					break;
				}
			}

			if (tooltip != null)
			{
				Rect tooltipRect = new Rect(Event.current.mousePosition.x, Event.current.mousePosition.y, 320, 600);
				GUILayout.BeginArea(tooltipRect);
				DrawCustomHelpBox(FormatItem(tooltip), MessageType.Info);
				GUILayout.EndArea();

				if (Event.current.type == EventType.MouseDown
					&& Event.current.button == 1 && rightRect.Contains(Event.current.mousePosition))
				{
					ShowMenu(tooltip);
				}
			}
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="tooltip"></param>
		private void ShowMenu(XRpcTreeViewItem<XRpcEditorMethod> tooltip)
        {
			GenericMenu menu = new GenericMenu();
			if (!tooltip.data.onlySend)
			{
				menu.AddItem(new GUIContent($"Set {tooltip.data.displayName} only send"), false, () =>
                {
					tooltip.data.onlySend = true;

					var name = XNetRpc.GetProtocolNameByHash(tooltip.data.hash);
					if (XNetAnalytics.TryGetMethod(tooltip.data.type, name, out var method))
						method.onlySend = tooltip.data.onlySend;
				});
			}

			if (tooltip.data.onlySend)
			{
				menu.AddItem(new GUIContent($"Unset {tooltip.data.displayName} only send"), false, () => {
					tooltip.data.onlySend = false;

					var name = XNetRpc.GetProtocolNameByHash(tooltip.data.hash);
					if (XNetAnalytics.TryGetMethod(tooltip.data.type, name, out var method))
						method.onlySend = tooltip.data.onlySend;
				});
			}

			menu.AddItem(new GUIContent($"Force send {tooltip.data.displayName}"),false, ()=> {
				Debug.LogError("xxxxx");
				
			});
				
			menu.ShowAsContext();
			Event.current.Use();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="tooltip"></param>
		/// <returns></returns>
		private string FormatItem(XRpcTreeViewItem<XRpcEditorMethod> tooltip)
        {
			StringBuilder sb = new StringBuilder();
			sb.AppendLine($"{tooltip.data.name}");
			sb.AppendLine($"Only send {tooltip.data.onlySend}");
			sb.AppendLine($"Send Time {tooltip.data.sendTime}");
			sb.AppendLine($"Recv Time {tooltip.data.recvTime}");
			sb.AppendLine();
			sb.AppendLine($"Send Total bytes {tooltip.data.sendBytes}");
			sb.AppendLine($"Recv Total bytes {tooltip.data.recvBytes}");
			sb.AppendLine($"Deay {tooltip.data.delay}");
			
			sb.AppendLine();
			sb.AppendLine($"Server call client methods count {tooltip.data.serverMethods.Count}");
			for(int idx=0; idx<tooltip.data.serverMethods.Count; idx++)
            {
				var methdName = tooltip.data.serverMethods[idx];
				sb.AppendLine($"[{idx}].{methdName}");
			}

			return sb.ToString();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="message"></param>
		/// <param name="messageType"></param>
		void DrawCustomHelpBox(string message, MessageType messageType)
		{
			Texture icon = null;

			switch (messageType)
			{
				case MessageType.Info:
					icon = EditorGUIUtility.IconContent("console.infoicon").image;
					break;
				case MessageType.Warning:
					icon = EditorGUIUtility.IconContent("console.warnicon").image;
					break;
				case MessageType.Error:
					icon = EditorGUIUtility.IconContent("console.erroricon").image;
					break;
			}

			Rect rect = EditorGUILayout.BeginVertical();
			EditorGUI.DrawRect(new Rect(rect.x+1, rect.y+1, rect.width-2, rect.height-2), new Color(0.2f, 0.2f, 0.2f, 1f));
			DrawBoxBorder(rect, Color.black);

			GUILayout.Space(8);
			EditorGUILayout.BeginHorizontal();
			GUILayout.Space(8);

			if (icon != null)
			{
				GUILayout.Box(icon, GUIStyle.none, GUILayout.Width(20), GUILayout.Height(20));
				GUILayout.Space(8);
			}

			GUIStyle textStyle = new GUIStyle(EditorStyles.label);
			textStyle.wordWrap = true;
			textStyle.normal.textColor = Color.white;

			EditorGUILayout.LabelField(message, textStyle);
			GUILayout.Space(8);
			EditorGUILayout.EndHorizontal();
			GUILayout.Space(8);

			EditorGUILayout.EndVertical();
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="rect"></param>
		/// <param name="color"></param>
		void DrawBoxBorder(Rect rect, Color color)
		{
			EditorGUI.DrawRect(new Rect(rect.x, rect.y, rect.width, 1), color);
			EditorGUI.DrawRect(new Rect(rect.x, rect.y + rect.height - 1, rect.width, 1), color);
			EditorGUI.DrawRect(new Rect(rect.x, rect.y, 1, rect.height), color);
			EditorGUI.DrawRect(new Rect(rect.x + rect.width - 1, rect.y, 1, rect.height), color);
		}
	

	/// <summary>
	/// 
	/// </summary>
	/// <param name="item"></param>
	/// <returns></returns>
		protected override bool CanRename(TreeViewItem item)
		{
			return false;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="args"></param>
		protected override void RenameEnded(RenameEndedArgs args)
		{
			// Set the backend name and reload the tree to reflect the new model
			if (args.acceptedRename)
			{
				var element = treeModel.Find(args.itemID);
				element.name = args.newName;
				Reload();
			}
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="rowRect"></param>
		/// <param name="row"></param>
		/// <param name="item"></param>
		/// <returns></returns>
		protected override Rect GetRenameRect(Rect rowRect, int row, TreeViewItem item)
		{
			Rect cellRect = GetCellRectForTreeFoldouts(rowRect);
			CenterRectUsingSingleLineHeight(ref cellRect);

			return base.GetRenameRect(cellRect, row, item);
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="item"></param>
		/// <returns></returns>
		protected override bool CanMultiSelect(TreeViewItem item)
		{
			return true;
		}

		/// <summary>
		/// 
		/// </summary>
		/// <param name="selectedIds"></param>
        protected override void SelectionChanged(IList<int> selectedIds)
        {

        }

		/// <summary>
		/// 
		/// </summary>
		/// <param name="treeViewWidth"></param>
		/// <returns></returns>
		public static MultiColumnHeaderState CreateDefaultMultiColumnHeaderState(float treeViewWidth)
		{
			var columns = new[]
			{
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent(EditorGUIUtility.FindTexture("FilterByLabel")),
					contextMenuText = "Flag",
					headerTextAlignment = TextAlignment.Center,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Right,
					width = 25,
					minWidth = 20,
					maxWidth = 60,
					autoResize = false,
					allowToggleVisibility = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent(EditorGUIUtility.FindTexture("FilterByType")),
					contextMenuText = "Type",
					headerTextAlignment = TextAlignment.Center,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Right,
					width = 40,
					minWidth = 20,
					maxWidth = 40,
					autoResize = false,
					allowToggleVisibility = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Name"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 120,
					minWidth = 60,
					maxWidth = 150,
					autoResize = false,
					allowToggleVisibility = false
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Hash"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Left,
					width = 85,
					minWidth = 60,
					maxWidth = 150,
					autoResize = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Send"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 40,
					minWidth = 40,
					autoResize = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Recv"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 40,
					minWidth = 40,
					autoResize = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Ping"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 40,
					minWidth = 36,
					autoResize = true,
					allowToggleVisibility = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Call"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 30,
					minWidth = 30,
					autoResize = true
				},
				new MultiColumnHeaderState.Column
				{
					headerContent = new GUIContent("Delay"),
					headerTextAlignment = TextAlignment.Left,
					sortedAscending = true,
					sortingArrowAlignment = TextAlignment.Center,
					width = 60,
					minWidth = 30,
					autoResize = true
				},
			};

			var state = new MultiColumnHeaderState(columns);
			return state;
		}
		
		/// <summary>
		/// 
		/// </summary>
		/// <param name="root"></param>
		/// <param name="result"></param>
		public static void TreeToList(TreeViewItem root, IList<TreeViewItem> result)
		{
			if (root == null)
				throw new NullReferenceException("root");
			if (result == null)
				throw new NullReferenceException("result");

			result.Clear();

			if (root.children == null)
				return;

			Stack<TreeViewItem> stack = new Stack<TreeViewItem>();
			for (int i = root.children.Count - 1; i >= 0; i--)
				stack.Push(root.children[i]);

			while (stack.Count > 0)
			{
				TreeViewItem current = stack.Pop();
				result.Add(current);

				if (current.hasChildren && current.children[0] != null)
				{
					for (int i = current.children.Count - 1; i >= 0; i--)
					{
						stack.Push(current.children[i]);
					}
				}
			}
		}
	}

	/// <summary>
	/// 
	/// </summary>
	static class XRpcHttpExtensionMethods
	{
		/// <summary>
		/// 
		/// </summary>
		/// <typeparam name="T"></typeparam>
		/// <typeparam name="TKey"></typeparam>
		/// <param name="source"></param>
		/// <param name="selector"></param>
		/// <param name="ascending"></param>
		/// <returns></returns>
		public static IOrderedEnumerable<T> Order<T, TKey>(this IEnumerable<T> source, Func<T, TKey> selector, bool ascending)
		{
			if (ascending)
			{
				return source.OrderBy(selector);
			}
			else
			{
				return source.OrderByDescending(selector);
			}
		}

		/// <summary>
		/// 
		/// </summary>
		/// <typeparam name="T"></typeparam>
		/// <typeparam name="TKey"></typeparam>
		/// <param name="source"></param>
		/// <param name="selector"></param>
		/// <param name="ascending"></param>
		/// <returns></returns>
		public static IOrderedEnumerable<T> ThenBy<T, TKey>(this IOrderedEnumerable<T> source, Func<T, TKey> selector, bool ascending)
		{
			if (ascending)
			{
				return source.ThenBy(selector);
			}
			else
			{
				return source.ThenByDescending(selector);
			}
		}
	}
}