using UnityEngine;
using UnityEditor;
using System.IO;
using Mono.Cecil;
using Mono.Cecil.Cil;
using System.Reflection;
using UnityEditor.Compilation;
using System.Collections.Generic;
using System.Linq;
using System;

namespace Oathx.Rpc.Editor
{
    /// <summary>
    /// 
    /// </summary>
    public static class XRpcInject
    {
        /// <summary>
        /// 
        /// </summary>
        [InitializeOnLoadMethod]
        public static void RpcStartup()
        {
            //CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="name"></param>
        /// <returns></returns>
        public static string GetInjectAssemblyName(string name)
        {
            return $"Library/ScriptAssemblies/{name}.dll";
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="playMode"></param>
        public static void OnAssemblyCompilationFinished(string file, CompilerMessage[] compilerMessages)
        {
            Inject();
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="self"></param>
        /// <param name="arguments"></param>
        /// <returns></returns>
        public static MethodReference GenericMethod(this MethodReference self, params TypeReference[] arguments)
        {
            if (self.GenericParameters.Count != arguments.Length)
                throw new System.ArgumentException();

            var instance = new GenericInstanceMethod(self);
            foreach (var argument in arguments)
                instance.GenericArguments.Add(argument);

            return instance;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="property"></param>
        /// <returns></returns>
        public static bool HasAttribute<T>(this PropertyDefinition property) where T : System.Attribute
        {
            var attributes = property.CustomAttributes;
            foreach (var attribute in attributes)
            {
                if (attribute.AttributeType.Name.Equals(typeof(T).Name))
                    return true;
            }

            return false;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="property"></param>
        /// <returns></returns>
        public static bool HasAttribute<T>(this MethodDefinition method) where T : System.Attribute
        {
            var attributes = method.CustomAttributes;
            foreach (var attribute in attributes)
            {
                if (attribute.AttributeType.Name.Equals(typeof(T).Name))
                    return true;
            }

            return false;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="method"></param>
        /// <returns></returns>
        public static CustomAttribute GetAttribute<T>(this MethodDefinition method) where T : System.Attribute
        {
            var attributes = method.CustomAttributes;
            foreach (var attribute in attributes)
            {
                if (attribute.AttributeType.Name.Equals(typeof(T).Name))
                    return attribute;
            }

            return null;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <typeparam name="T"></typeparam>
        /// <param name="method"></param>
        /// <returns></returns>
        public static bool HasAttribute<T>(this TypeDefinition method) where T : System.Attribute
        {
            var attributes = method.CustomAttributes;
            foreach (var attribute in attributes)
            {
                if (attribute.AttributeType.Name.Equals(typeof(T).Name))
                    return true;
            }
            return false;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="worker"></param>
        /// <param name="index"></param>
        /// <returns></returns>
        public static Instruction CreateLdcI4(ILProcessor worker, int index)
        {
            switch (index)
            {
                case 0: return worker.Create(OpCodes.Ldc_I4_0);
                case 1: return worker.Create(OpCodes.Ldc_I4_1);
                case 2: return worker.Create(OpCodes.Ldc_I4_2);
                case 3: return worker.Create(OpCodes.Ldc_I4_3);
                case 4: return worker.Create(OpCodes.Ldc_I4_4);
                case 5: return worker.Create(OpCodes.Ldc_I4_5);
                case 6: return worker.Create(OpCodes.Ldc_I4_6);
                case 7: return worker.Create(OpCodes.Ldc_I4_7);
                case 8: return worker.Create(OpCodes.Ldc_I4_8);

                default:
                    if (index >= -128 && index <= 127)
                        return worker.Create(OpCodes.Ldc_I4_S, (sbyte)index);

                    return worker.Create(OpCodes.Ldc_I4, index);
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="worker"></param>
        /// <param name="index"></param>
        /// <returns></returns>
        public static Instruction CreateLdarg(ILProcessor worker, int index)
        {
            switch (index)
            {
                case 0: return worker.Create(OpCodes.Ldarg_0);
                case 1: return worker.Create(OpCodes.Ldarg_1);
                case 2: return worker.Create(OpCodes.Ldarg_2);
                case 3: return worker.Create(OpCodes.Ldarg_3);

                default:
                    if (index > 0 && index <= 255)
                    {
                        return worker.Create(OpCodes.Ldarg_S, index);
                    }
                    else
                    {
                        return worker.Create(OpCodes.Ldarg, index);
                    }
            }
        }

        /// <summary>
        /// inject function type
        /// </summary>
        public enum MethodType
        {
            CallTcpServer,
            CallTcpHash,
            CallWebHash,
            CallHttpServer,
        }

        /// <summary>
        /// 
        /// </summary>
        public class DefaultCustomResolver : BaseAssemblyResolver
        {
            private DefaultAssemblyResolver defaultResolver;

            public DefaultCustomResolver()
            {
                defaultResolver = new DefaultAssemblyResolver();
            }

            public override AssemblyDefinition Resolve(AssemblyNameReference name)
            {
                AssemblyDefinition assembly;
                try
                {
                    assembly = defaultResolver.Resolve(name);
                }
                catch (AssemblyResolutionException exception)
                {
                    string assemblyPath = Path.Combine(Application.dataPath.Replace("Assets", ""),
                        $"Library/ScriptAssemblies/{exception.AssemblyReference.Name}.dll");

                    if (!File.Exists(assemblyPath))
                        Debug.LogError($"Can't find {assemblyPath}");

                    assembly = AssemblyDefinition.ReadAssembly(assemblyPath);
                }

                return assembly;
            }
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="assemblyName"></param>
        /// <returns></returns>
        public static bool Inject(string assemblyName)
        {
            string assemblyPath = Path.Combine(Application.dataPath.Replace("Assets", ""), assemblyName);
            try
            {
                EditorApplication.LockReloadAssemblies();

                using (var assembly = AssemblyDefinition.ReadAssembly(assemblyPath, new ReaderParameters()
                {
                    ReadSymbols = true,
                    SymbolReaderProvider = new Mono.Cecil.Pdb.PdbReaderProvider(),
                    AssemblyResolver = new DefaultCustomResolver()
                }))
                {
                    if (Inject(assembly.MainModule))
                    {
                        assembly.Write(assemblyPath, new WriterParameters()
                        {
                            WriteSymbols = true,
                            SymbolWriterProvider = new Mono.Cecil.Pdb.PdbWriterProvider()
                        });
                    }
                }
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
            }
            finally
            {
                EditorApplication.UnlockReloadAssemblies();
            }

            return true;
        }

        [MenuItem("Custom/Enable Full StackTraces")]
        static void EnableFullStackTraces()
        {
            Unity.Collections.NativeLeakDetection.Mode = Unity.Collections.NativeLeakDetectionMode.EnabledWithStackTrace;
        }

        /// <summary>
        /// try inject set function to model
        /// </summary>
        [MenuItem("Rpc/Inject")]
        public static void Inject()
        {
            List<string> assemblys = new List<string>();

            var assemblyNames = XNetRpcSettings.Instance.injectAssemblyNames;
            if (assemblyNames != null)
                assemblys.AddRange(assemblyNames);

            var assemblyDefinitionAssets = XNetRpcSettings.Instance.assemblyDefinitionAssets;
            if (assemblyDefinitionAssets != null)
            {
                foreach (var assemblyDefinitionAsset in assemblyDefinitionAssets)
                {
                    if (assemblyDefinitionAsset != null)
                        assemblys.Add(assemblyDefinitionAsset.name);
                }
            }

            foreach (var name in assemblys)
            {
                string injectAssembly = GetInjectAssemblyName(name);
                string assemblyFile = injectAssembly.Replace("\\", "/");
                if (assemblyFile == injectAssembly)
                {
                    Inject(injectAssembly);
                }
            }
        }

        /// <summary>
        /// inject module
        /// </summary>
        /// <param name="module"></param>
        /// <returns></returns>
        public static bool Inject(ModuleDefinition module)
        {
            foreach (var type in module.Types)
            {
                foreach (var method in type.Methods)
                {
                    if (method.HasAttribute<RpcClientCallServer>())
                    {
                        Execute(module, method);
                    }
                }
            }

            return true;
        }

        /// <summary>
        /// execute inject
        /// </summary>
        /// <param name="module"></param>
        /// <param name="method"></param>
        public static void Execute(ModuleDefinition module, MethodDefinition method)
        {
            var attributes = method.CustomAttributes;
            foreach (var attribute in attributes)
            {
                if (attribute.AttributeType.Name.Equals(typeof(RpcClientCallServer).Name))
                {
                    if (attribute.HasConstructorArguments)
                    {
                        var type = attribute.ConstructorArguments[0];
                        var http = attribute.ConstructorArguments[1];
                        var hash = attribute.ConstructorArguments[2];
                        switch (type.Value)
                        {
                            // inject local call
                            case 0:
                                break;

                            // inject tcp call
                            case 1:
                                var callTcpServerMethod = module.ImportReference(typeof(XNetRpc).GetMethod(MethodType.CallTcpHash.ToString(),
                                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Static));

                                InjectCallHash(module, method, callTcpServerMethod, (int)hash.Value);
                                break;

                            // inject web call
                            case 3:
                                var callWebServerMethod = module.ImportReference(typeof(XNetRpc).GetMethod(MethodType.CallWebHash.ToString(),
                                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Static));

                                InjectCallHash(module, method, callWebServerMethod, (int)hash.Value);
                                break;

                            // inject http call
                            case 4:
                                var callHttpServerMethod = module.ImportReference(typeof(XNetRpc).GetMethod(MethodType.CallHttpServer.ToString(),
                                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Static));

                                InjectCallHttpServer(module, method, callHttpServerMethod, (TypeDefinition)http.Value, (int)hash.Value);
                                break;
                            default:
                                throw new NotImplementedException(((XRpcType)type.Value).ToString());
                        }
                    }
                }
            }
        }

        /// <summary>
        /// box value type
        /// </summary>
        /// <param name="module"></param>
        /// <param name="worker"></param>
        /// <param name="tr"></param>
        public static void BoxValueType(ModuleDefinition module, ILProcessor worker, TypeReference tr)
        {
            var metadataType = tr.MetadataType;
            switch (metadataType)
            {
                case MetadataType.Boolean:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(bool))));
                    break;
                case MetadataType.Char:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(char))));
                    break;
                case MetadataType.Byte:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(byte))));
                    break;
                case MetadataType.Int32:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(int))));
                    break;
                case MetadataType.UInt32:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(uint))));
                    break;
                case MetadataType.Int16:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(short))));
                    break;
                case MetadataType.UInt16:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(ushort))));
                    break;
                case MetadataType.Single:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(float))));
                    break;
                case MetadataType.Double:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(double))));
                    break;
                case MetadataType.Int64:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(long))));
                    break;
                case MetadataType.UInt64:
                    worker.Append(worker.Create(OpCodes.Box, module.ImportReference(typeof(ulong))));
                    break;
                default:
                    Debug.LogError($"Unsupported metadata types {metadataType}");
                    break;
            }
        }

        //.method public hidebysig
        //    instance void Login(
        //        string username,
        //        string password
        //    ) cil managed
        //        {
        //	.custom instance void[com.oathx.rpc] Oathx.Rpc.RpcClientCallServer::.ctor(valuetype[com.oathx.rpc] Oathx.Rpc.XRpcType, int32) = (
        //		01 00 01 00 00 00 00 00 00 00 00 00
        //	)
        //	// Method begins at RVA 0x23f1
        //	// Header size: 1
        //	// Code size: 29 (0x1d)
        //	.maxstack 8

        //	IL_0000: nop
        //    IL_0001: ldarg.0
        //	IL_0002: ldc.i4 1441655762
        //	IL_0007: ldc.i4.2
        //	IL_0008: newarr[mscorlib] System.Object

        //    IL_000d: dup
        //    IL_000e: ldc.i4.0

        //    IL_000f: ldarg.1

        //    IL_0010: stelem.ref
        //    IL_0011: dup
        //    IL_0012: ldc.i4.1

        //    IL_0013: ldarg.2

        //    IL_0014: stelem.ref
        //    IL_0015: call void[com.oathx.rpc] Oathx.Rpc.XNetRpc::CallTcpHash(int32, object[])
        //    IL_001a: nop
        //    IL_001b: pop
        //    IL_001c: ret
        //}
        // end of method MsgPackTcpClient::Login
        public static bool InjectCallHash(ModuleDefinition module, MethodDefinition method, MethodReference callMethod, int hash)
        {
            if (!CheckMethodReturnValueType(method, callMethod))
            {
                Debug.LogError($"Inject method {method.DeclaringType}.{method.Name} Failure, return value type must be [System.Void]");
                return false;
            }

            var worker = method.Body.GetILProcessor();
            if (worker != null)
            {
                // clear method body
                method.Body.Instructions.Clear();

                // clear method exception info
                if (method.Body.HasExceptionHandlers)
                    method.Body.ExceptionHandlers.Clear();

                worker.Append(worker.Create(OpCodes.Nop));
                if (!method.IsStatic)
                {
                    Debug.LogError($"You are currently injecting a non-static RPC server method {method.DeclaringType.Name}.{method.Name}, " +
                        $"which is not recommended. Please use a static RPC server method");

                    worker.Append(worker.Create(OpCodes.Ldarg_0));
                }

                worker.Append(worker.Create(OpCodes.Ldc_I4, hash == 0 ? XNetUtility.HashString(method.Name) : hash));

                // load rpc params
                var ldcParamCount = CreateLdcI4(worker, method.Parameters.Count);
                worker.Append(ldcParamCount);
                worker.Append(worker.Create(OpCodes.Newarr,
                    module.ImportReference(typeof(object))));

                for (int i = 0; i < method.Parameters.Count; i++)
                {
                    worker.Append(worker.Create(OpCodes.Dup));

                    var ldcI4 = CreateLdcI4(worker, i);
                    worker.Append(ldcI4);

                    var paramIndex = method.IsStatic ? i : i + 1;
                    var ldarg = CreateLdarg(worker, paramIndex);
                    worker.Append(ldarg);

                    if (method.Parameters[i].ParameterType.IsValueType)
                    {
                        BoxValueType(module, worker, method.Parameters[i].ParameterType);
                    }

                    worker.Append(worker.Create(OpCodes.Stelem_Ref));
                }

                // call tcp send message to server
                worker.Append(worker.Create(OpCodes.Call, callMethod));
                worker.Append(worker.Create(OpCodes.Nop));

                if (!method.IsStatic)
                    worker.Append(worker.Create(OpCodes.Pop));

                worker.Append(worker.Create(OpCodes.Ret));

                Log($"inject method <color=green>{method.Name}</color> {callMethod.Name} to <color=white>{module.Name}</color> <color=green>succeed</color>");
            }

            return true;
        }

        /// <summary>
        /// check method return value type
        /// </summary>
        /// <param name="method"></param>
        /// <param name="callMethod"></param>
        /// <returns></returns>
        static bool CheckMethodReturnValueType(MethodDefinition method, MethodReference callMethod)
        {
            return method.ReturnType.FullName == callMethod.ReturnType.FullName;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="message"></param>
        static void Log(object message)
        {
            if (XNetRpcSettings.Instance.outputDebugLog)
                Debug.Log(message);
        }

        //.method public hidebysig
        //    instance void ReqHost(

        //        class HostBody body,
        //		class [netstandard] System.Action`2<int32, class HostResponse> complete
        //	) cil managed
        //        {
        //	.custom instance void[com.oathx.rpc] Oathx.Rpc.RpcClientCallServer::.ctor(valuetype[com.oathx.rpc] Oathx.Rpc.XRpcType, int32) = (
        //		01 00 04 00 00 00 00 00 00 00 00 00
        //	)
        //	// Method begins at RVA 0x223a
        //	// Header size: 1
        //	// Code size: 17 (0x11)
        //	.maxstack 8

        //	IL_0000: nop
        //  IL_0001: ldarg.0
        //	IL_0002: ldstr "ReqHost"
        //	IL_0007: ldarg.1
        //	IL_0008: ldarg.2
        //	IL_0009: call void[com.oathx.rpc] Oathx.Rpc.XNetRpc::CallHttpServer<class HostResponse>(string, object, class [mscorlib] System.Action`2<int32, !!0>)
        //	IL_000e: nop
        //  IL_000f: pop
        //  IL_0010: ret
        //} 
        // end of method XRpcHttpClient::ReqHost
        public static bool InjectCallHttpServer(ModuleDefinition module, MethodDefinition method, MethodReference callMethod,
            TypeDefinition typeDefinition, int hash)
        {
            var worker = method.Body.GetILProcessor();
            if (worker != null)
            {
                bool useTypeDefinition = typeDefinition != null;

                // get generic response type from method parameters
                TypeReference typeReference = GetGenericMethod(module, method);
                if (typeReference != null)
                {
                    useTypeDefinition = false;
                }
                else
                {
                    // if method parameters not has generic type, use type definition from attribute
                    typeReference = ConvertToTypeReference(module, typeDefinition);
                }

                // if type reference is null, throw exception
                if (typeReference == null)
                    throw new ArgumentException($"Inject http call method {method.DeclaringType}.{method.Name} failure, " +
                        $"can't get generic response type from attribute or method parameters");

                // force clear method body
                method.Body.Instructions.Clear();

                // append IL nop 
                worker.Append(worker.Create(OpCodes.Nop));
                // if the method is no static, must be load this param
                if (!method.IsStatic)
                    worker.Append(worker.Create(OpCodes.Ldarg_0));

                // append method name
                worker.Append(worker.Create(OpCodes.Ldstr, method.Name));

                // inject parameters
                for (int i = 0; i < method.Parameters.Count; i++)
                {
                    var index = method.IsStatic ? i : i + 1;
                    var ldarg = CreateLdarg(worker, index);
                    worker.Append(ldarg);
                }

                if (useTypeDefinition)
                    worker.Append(worker.Create(OpCodes.Ldnull));

                // call http rpc method
                worker.Append(worker.Create(OpCodes.Call, callMethod.GenericMethod(typeReference)));
                worker.Append(worker.Create(OpCodes.Nop));

                // if the method is no static, must be pop this param
                if (!method.IsStatic)
                    worker.Append(worker.Create(OpCodes.Pop));

                worker.Append(worker.Create(OpCodes.Ret));
            }

            return true;
        }

        /// <summary>
        /// convert to type reference
        /// </summary>
        /// <param name="module"></param>
        /// <param name="typeObject"></param>
        /// <returns></returns>
        /// <exception cref="ArgumentException"></exception>
        private static TypeReference ConvertToTypeReference(ModuleDefinition module, object typeObject)
        {
            if (typeObject is TypeReference typeReference)
                return typeReference;
            else if (typeObject is Type type)
                return module.ImportReference(type);
            else if (typeObject is string typeName)
                return module.ImportReference(Type.GetType(typeName));

            throw new ArgumentException("Unsupported type object", nameof(typeObject));
        }

        /// <summary>
        /// get generic method
        /// </summary>
        /// <param name="method"></param>
        /// <returns></returns>
        public static TypeReference GetGenericMethod(ModuleDefinition module, MethodDefinition method)
        {
            foreach (var p in method.Parameters)
            {
                if (p.ParameterType.MetadataType == MetadataType.GenericInstance)
                {
                    var vv = p.ParameterType as GenericInstanceType;
                    if (vv.GenericArguments.Count == 2)
                        return vv.GenericArguments[1];
                }
            }

            return null;
        }

        //  .method public hidebysig static
        //    void ReqServerTime<T>(

        //        class Oathx.HttpProtocol.ServerTime body
        //	) cil managed
        //        {
        //	// Method begins at RVA 0x27a4
        //	// Header size: 1
        //	// Code size: 15 (0xf)
        //	.maxstack 8

        //	// {
        //	IL_0000: nop
        //    // XNetRpc.CallHttpServer<ServerTimeResponse>("ReqServerTime", body, null);
        //    IL_0001: ldstr "ReqServerTime"
        //	IL_0006: ldarg.0
        //	IL_0007: ldnull
        //    IL_0008: call void [Oathx.Rpc] Oathx.Rpc.XNetRpc::CallHttpServer<class Oathx.HttpProtocol.ServerTimeResponse>(string, object, class [netstandard] System.Action`2<int32, !!0>)
        //	// }
        //	IL_000d: nop
        //    IL_000e: ret
        //    } // end of method Rpc::ReqServerTime
        //

        //        .method public hidebysig static
        //    void ReqServerTime(

        //        class Oathx.HttpProtocol.ServerTime body
        //	) cil managed
        //        {
        //	// Method begins at RVA 0x27a4
        //	// Header size: 1
        //	// Code size: 15 (0xf)
        //	.maxstack 8

        //	// {
        //	IL_0000: nop
        //    // XNetRpc.CallHttpServer<ServerTimeResponse>("ReqServerTime", body, null);
        //    IL_0001: ldstr "ReqServerTime"
        //	IL_0006: ldarg.0
        //	IL_0007: ldnull
        //    IL_0008: call void [Oathx.Rpc] Oathx.Rpc.XNetRpc::CallHttpServer<class Oathx.HttpProtocol.ServerTimeResponse>(string, object, class [netstandard] System.Action`2<int32, !!0>)
        //	// }
        //	IL_000d: nop
        //    IL_000e: ret
        //    } // end of method Rpc::ReqServerTime
        //
    }
}
