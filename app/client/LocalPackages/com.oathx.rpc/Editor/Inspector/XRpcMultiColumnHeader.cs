using UnityEngine;
using UnityEditor;
using UnityEditor.IMGUI.Controls;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public class XRpcMultiColumnHeader : MultiColumnHeader
    {
        private Mode _mode;

        /// <summary>
        /// 
        /// </summary>
        public enum Mode
        {
            LargeHeader,
            DefaultHeader,
            MinimumHeaderWithoutSorting
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="state"></param>
        public XRpcMultiColumnHeader(MultiColumnHeaderState state)
            : base(state)
        {
            mode = Mode.DefaultHeader;
        }

        /// <summary>
        /// 
        /// </summary>
        public Mode mode
        {
            get
            {
                return _mode;
            }
            set
            {
                _mode = value;
             
                switch (_mode)
                {
                    case Mode.LargeHeader:
                        canSort = true;
                        height = 37f;
                        break;
                    case Mode.DefaultHeader:
                        canSort = true;
                        height = DefaultGUI.defaultHeight;
                        break;
                    case Mode.MinimumHeaderWithoutSorting:
                        canSort = false;
                        height = DefaultGUI.minimumHeight;
                        break;
                }
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="column"></param>
        /// <param name="headerRect"></param>
        /// <param name="columnIndex"></param>
        protected override void ColumnHeaderGUI(MultiColumnHeaderState.Column column, Rect headerRect, int columnIndex)
        {
            // Default column header gui
            base.ColumnHeaderGUI(column, headerRect, columnIndex);

            // Add additional info for large header
            if (mode == Mode.LargeHeader)
            {
                // Show example overlay stuff on some of the columns
                if (columnIndex > 2)
                {
                    headerRect.xMax -= 3f;
                    var oldAlignment = EditorStyles.largeLabel.alignment;
                    EditorStyles.largeLabel.alignment = TextAnchor.UpperRight;
                    GUI.Label(headerRect, 36 + columnIndex + "%", EditorStyles.largeLabel);
                    EditorStyles.largeLabel.alignment = oldAlignment;
                }
            }
        }
    }
}

