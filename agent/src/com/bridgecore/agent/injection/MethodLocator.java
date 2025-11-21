package com.bridgecore.agent.injection;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * 方法定位器 - 负责在类中查找目标方法
 */
public class MethodLocator {
    private final InjectionConfig.MethodSignature methodSignature;

    public MethodLocator(InjectionConfig.MethodSignature methodSignature) {
        this.methodSignature = methodSignature;
    }

    /**
     * 通过反射查找匹配的方法
     */
    public List<Method> locateMethods(Class<?> clazz) {
        List<Method> foundMethods = new ArrayList<>();
        
        for (Method method : clazz.getDeclaredMethods()) {
            String descriptor = Type.getMethodDescriptor(method);
            if (matches(method.getName(), descriptor)) {
                foundMethods.add(method);
            }
        }
        
        return foundMethods;
    }

    /**
     * 通过 ASM 查找匹配的方法（用于字节码转换）
     */
    public List<MethodInfo> locateMethods(byte[] classBytes) {
        List<MethodInfo> foundMethods = new ArrayList<>();
        
        ClassReader cr = new ClassReader(classBytes);
        cr.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                if (matches(name, descriptor)) {
                    foundMethods.add(new MethodInfo(name, descriptor, access));
                }
                return null; // 不修改，只查找
            }
        }, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG);
        
        return foundMethods;
    }

    /**
     * 检查方法是否匹配
     */
    public boolean matches(String methodName, String descriptor) {
        if (!methodSignature.matchesName(methodName)) {
            return false;
        }
        if (!methodSignature.matchesDescriptor(descriptor)) {
            return false;
        }
        
        // 排除构造函数和静态初始化块
        if (methodName.equals("<init>") || methodName.equals("<clinit>")) {
            return false;
        }
        
        // 解析方法类型
        Type methodType = Type.getMethodType(descriptor);
        Type[] argTypes = methodType.getArgumentTypes();
        Type returnType = methodType.getReturnType();
        
        // 检查是否是玩家列表方法（返回 Collection 或 List）
        if (methodSignature.getParameterIndex() == -1) {
            // 这是玩家列表方法配置
            // 只匹配无参数的方法（getter 方法）
            if (argTypes.length > 0) {
                return false;
            }
            
            // 返回类型必须是 Collection 或 List
            String returnTypeName = returnType.getInternalName();
            boolean isCollection = returnTypeName.equals("java/util/Collection") ||
                                 returnTypeName.equals("java/util/List") ||
                                 returnType.getSort() == Type.ARRAY;
            
            if (!isCollection) {
                return false;
            }
            
            // 匹配常见的方法名（无参数）
            if (methodName.equals("getPlayers") || 
                methodName.equals("getOnlinePlayers") ||
                methodName.equals("players") ||
                methodName.equals("getAllPlayers")) {
                return true;
            }
            
            // 对于混淆的方法，如果返回 List 且无参数，也匹配（但需要更严格的检查）
            // 只匹配看起来像 getter 的方法（短方法名通常是混淆后的 getter）
            if (methodName.length() <= 3 && descriptor.contains("List") && argTypes.length == 0) {
                return true;
            }
            
            return false;
        }
        
        // 聊天处理方法参数通常 1-4 个（例如 tryHandleChat(String, boolean, Runnable)）
        if (argTypes.length == 0 || argTypes.length > 4) {
            return false;
        }
        
        // 第一个参数必须是 String（聊天消息）
        if (!argTypes[0].equals(Type.getType(String.class))) {
            return false;
        }
        
        // 返回类型必须是 void 或 boolean
        if (returnType != Type.VOID_TYPE && returnType != Type.BOOLEAN_TYPE) {
            return false;
        }
        
        // 排除明显的工具方法
        if (methodName.equals("toString") || methodName.equals("equals") || 
            methodName.equals("hashCode") || methodName.equals("println") ||
            methodName.startsWith("get") || methodName.startsWith("set") ||
            methodName.equals("close") || methodName.equals("loadPacks")) {
            return false;
        }
        
        return true;
    }

    /**
     * 计算消息参数在方法参数中的局部变量索引
     * 返回第一个 String 参数的局部变量索引
     */
    public int computeMessageVarIndex(String descriptor, boolean isStatic) {
        Type[] argumentTypes = Type.getArgumentTypes(descriptor);
        int index = isStatic ? 0 : 1; // 非静态方法，索引 0 是 this

        // 找到第一个 String 参数
        for (int i = 0; i < argumentTypes.length; i++) {
            Type type = argumentTypes[i];
            if (type.equals(Type.getType(String.class))) {
                // 如果配置指定了参数索引，检查是否匹配
                int expectedIndex = methodSignature.getParameterIndex();
                if (expectedIndex < 0 || i == expectedIndex) {
                    return index;
                }
            }
            index += type.getSize();
        }
        return -1;
    }

    /**
     * 方法信息
     */
    public static class MethodInfo {
        private final String name;
        private final String descriptor;
        private final int access;

        public MethodInfo(String name, String descriptor, int access) {
            this.name = name;
            this.descriptor = descriptor;
            this.access = access;
        }

        public String getName() {
            return name;
        }

        public String getDescriptor() {
            return descriptor;
        }

        public int getAccess() {
            return access;
        }

        public boolean isStatic() {
            return (access & Opcodes.ACC_STATIC) != 0;
        }
    }
}


