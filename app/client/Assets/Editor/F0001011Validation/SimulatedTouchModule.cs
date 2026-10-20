using System.Reflection;
using UnityEngine;
using UnityEngine.EventSystems;

namespace GameAI.Validation
{
    /// <summary>Feeds simulated touches through UGUI raycasting and its native touch press pipeline.</summary>
    public static class SimulatedTouchModule
    {
        /// <summary>Registers the native module lifecycle in the isolated Editor test scene.</summary>
        public static void InitializeForEditor(StandaloneInputModule module)
        {
            typeof(BaseInputModule).GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, null);
        }

        /// <summary>Resolves the touch through raycasting before invoking native press and release handling.</summary>
        public static void ProcessTouch(StandaloneInputModule module, Touch touch)
        {
            object[] arguments =
            {
                touch,
                false,
                false
            };
            PointerEventData pointer = (PointerEventData)typeof(PointerInputModule).GetMethod("GetTouchPointerEventData", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, arguments);
            bool pressed = (bool)arguments[1];
            bool released = (bool)arguments[2];
            typeof(StandaloneInputModule).GetMethod("ProcessTouchPress", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, new object[]
            {
                pointer,
                pressed,
                released
            });
            if (released)
            {
                typeof(PointerInputModule).GetMethod("RemovePointerData", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, new object[]
                {
                    pointer
                });
            }
            else
            {
                typeof(StandaloneInputModule).GetMethod("ProcessMove", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, new object[]
                {
                    pointer
                });
                typeof(StandaloneInputModule).GetMethod("ProcessDrag", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(module, new object[]
                {
                    pointer
                });
            }
        }
    }
}
