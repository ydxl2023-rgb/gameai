using System.Collections.Generic;
using UnityEngine;
using UnityEditor.IMGUI.Controls;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public class XRpcTable : XRpcTrackTable
    {
        protected XRpcTreeView _treeView;
        protected bool _initialized;
        protected Rect _position;
        protected XRpcTrackInfo _rpcTrack;

        [SerializeField]
        private TreeViewState _treeViewState;
        [SerializeField]
        private MultiColumnHeaderState _multiColumnHeaderState;

        /// <summary>
        /// 
        /// </summary>
        public XRpcTable()
        {
            
        }

        /// <summary>
        /// 
        /// </summary>
        /// <returns></returns>
        public virtual IList<XRpcEditorMethod> GetData()
        {
            if (_rpcTrack != null)
                return _rpcTrack.methods;

            return null;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="asset"></param>
        public virtual void OnOpened(XRpcTrackInfo track)
        {
            _rpcTrack = track;
            _initialized = false;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="rect"></param>
        public virtual void OnEnable(Rect rect)
        {
  
        }

        /// <summary>
        /// 
        /// </summary>
        public virtual void OnDisable()
        {

        }

        public virtual void SessionBar(Rect rect)
        {

        }

        public virtual void BottomToolbar(Rect rect)
        {

        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="rect"></param>
        public virtual void OnGUI(Rect rect)
        {
            _position = rect;

            InitIfNeeded();

            if (_treeView != null)
            {
                _treeView.OnGUI(multiColumnTreeViewRect);
            }
                
            SessionBar(bottomSessionBarRect);
            BottomToolbar(bottomToolbarRect);
        }

        /// <summary>
        /// 
        /// </summary>
        public virtual void OnUpdate()
        {
        }

        /// <summary>
        /// 
        /// </summary>
        public virtual void OnReload()
        {

        }

        /// <summary>
        /// 
        /// </summary>
        protected Rect multiColumnTreeViewRect
        {
            get { return new Rect(10, 30, _position.width - 20, _position.height - 160); }
        }

        /// <summary>
        /// 
        /// </summary>
        protected Rect bottomToolbarRect
        {
            get { return new Rect(20f, _position.height - 25, _position.width - 40f, 20); }
        }

        protected Rect bottomSessionBarRect
        {
            get { return new Rect(10, _position.height - 125, _position.width - 20, 90); }
        }

        /// <summary>
        /// 
        /// </summary>
        public virtual void InitIfNeeded()
        {
            if (!_initialized)
            {
                if (_treeViewState == null)
                    _treeViewState = new TreeViewState();

                bool firstInit = _multiColumnHeaderState == null;
                var headerState = XRpcTreeView.CreateDefaultMultiColumnHeaderState(multiColumnTreeViewRect.width);

                if (MultiColumnHeaderState.CanOverwriteSerializedFields(_multiColumnHeaderState, headerState))
                    MultiColumnHeaderState.OverwriteSerializedFields(_multiColumnHeaderState, headerState);

                _multiColumnHeaderState = headerState;

                var multiColumnHeader = new XRpcMultiColumnHeader(headerState);
                if (firstInit)
                    multiColumnHeader.ResizeToFit();

                var treeModel = new XRpcTreeModel<XRpcEditorMethod>(GetData());

                _treeView = new XRpcTreeView(_treeViewState, multiColumnHeader, treeModel);
                _initialized = true;
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="debugInfo"></param>
        public void UpdateTrackMethod(XNetStatistics statistics, List<XRpcEditorMethod> methods)
        {
            foreach (var method in methods)
            {
                if (statistics.TryGetNetMethod(method.name, out var track))
                {
                    if (track.sendTime > 0 && track.recvTime > 0)
                    {
                        var currentPing = track.recvTime - track.sendTime;
                        if (currentPing < 3000)
                            method.ping = currentPing;
                    }
                        
                    method.send = track.send;
                    method.recv = track.recv;
                    method.call = track.call;
                    method.sendBytes = track.sendByte;
                    method.recvBytes = track.recvByte;
                    method.sendTime = track.sendTime;
                    method.recvTime = track.recvTime;
                }
            }
        }
    }
}

