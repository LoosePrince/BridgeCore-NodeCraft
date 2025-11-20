package com.bridgecore.agent;

import com.bridgecore.agent.injection.*;
import com.bridgecore.agent.logging.AgentLogger;
import org.objectweb.asm.*;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

/**
 * 聊天消息拦截器 - 字节码转换器
 * 使用模块化的类查找和代码注入策略
 */
public class ChatInterceptorTransformer implements ClassFileTransformer {
    private final InjectionConfig config;
    private final MethodLocator methodLocator;
    private final CodeInjectionStrategy injectionStrategy;

    public ChatInterceptorTransformer(InjectionConfig config) {
        this.config = config;
        this.methodLocator = new MethodLocator(config.getTargetMethod());
        this.injectionStrategy = new CodeInjectionStrategy();
    }

    @Override
    public byte[] transform(ClassLoader loader, String className,
                            Class<?> classBeingRedefined,
                            ProtectionDomain protectionDomain,
                            byte[] classfileBuffer) {
        if (className == null) {
            return classfileBuffer;
        }

        // 将内部类名转换为标准格式
        String internalName = className.replace('.', '/');
        String classNameWithDots = className.replace('/', '.');
        
        // 检查是否匹配目标类（支持通配符）
        boolean matches = false;
        for (String targetName : config.getTargetClassNames()) {
            String targetInternal = targetName.replace('.', '/');
            
            // 精确匹配
            if (className.equals(targetName) || internalName.equals(targetInternal) || 
                classNameWithDots.equals(targetName)) {
                matches = true;
                AgentLogger.debug("[Transformer] 匹配类: " + classNameWithDots);
                break;
            }
            
            // 通配符匹配
            if (targetName.contains("*")) {
                String pattern = targetName.replace("*", ".*").replace(".", "\\.");
                if (classNameWithDots.matches(pattern) || className.matches(pattern)) {
                    matches = true;
                    AgentLogger.debug("[Transformer] 匹配类: " + classNameWithDots);
                    break;
                }
            }
            
            // 后缀匹配（如 *ServerPlayNetworkHandler）
            if (targetName.startsWith("*")) {
                String suffix = targetName.substring(1);
                if (classNameWithDots.endsWith(suffix) || className.endsWith(suffix)) {
                    matches = true;
                    AgentLogger.debug("[Transformer] 匹配类: " + classNameWithDots);
                    break;
                }
            }
        }

        if (!matches) {
            return classfileBuffer;
        }

        AgentLogger.debug("[Transformer] 处理类: " + className + " (服务端: " + config.getServerType().getDisplayName() + ")");

        try {
            ClassReader cr = new ClassReader(classfileBuffer);
            ClassWriter cw = new SafeClassWriter(ClassWriter.COMPUTE_MAXS | ClassWriter.COMPUTE_FRAMES, loader);
            ClassVisitor cv = new ChatMessageVisitor(cw, className);
            cr.accept(cv, ClassReader.EXPAND_FRAMES);
            AgentLogger.debug("[Transformer] 字节码修改成功: " + className);
            return cw.toByteArray();
        } catch (Exception e) {
            AgentLogger.error("[Transformer] 修改失败: " + e.getMessage(), e);
            return classfileBuffer;
        }
    }

    /**
     * 类访问器 - 修改类的方法
     */
    class ChatMessageVisitor extends ClassVisitor {
        private final String className;

        public ChatMessageVisitor(ClassVisitor cv, String className) {
            super(Opcodes.ASM9, cv);
            this.className = className;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            MethodVisitor mv = super.visitMethod(access, name, descriptor, signature, exceptions);

            // 使用 MethodLocator 检查方法是否匹配
            boolean matches = methodLocator.matches(name, descriptor);
            
            if (matches) {
                AgentLogger.debug("[Transformer] 匹配到方法: " + name + descriptor);
            }

            if (!matches) {
                return mv;
            }

            // 创建方法信息
            MethodLocator.MethodInfo methodInfo = new MethodLocator.MethodInfo(name, descriptor, access);
            
            AgentLogger.debug("[Transformer] 拦截方法: " + name + descriptor);
            
            // 使用 CodeInjectionStrategy 创建方法访问器
            return injectionStrategy.createMethodVisitor(mv, access, name, descriptor, methodInfo, methodLocator);
        }
    }

    /**
     * 安全的 ClassWriter，避免 ClassNotFoundException
     */
    static class SafeClassWriter extends ClassWriter {
        private final ClassLoader loader;

        SafeClassWriter(int flags, ClassLoader loader) {
            super(flags);
            this.loader = loader;
        }

        @Override
        protected String getCommonSuperClass(String type1, String type2) {
            try {
                Class<?> c1 = Class.forName(type1.replace('/', '.'), false, loader);
                Class<?> c2 = Class.forName(type2.replace('/', '.'), false, loader);

                if (c1.isAssignableFrom(c2)) {
                    return type1;
                }
                if (c2.isAssignableFrom(c1)) {
                    return type2;
                }
                if (c1.isInterface() || c2.isInterface()) {
                    return "java/lang/Object";
                }

                do {
                    c1 = c1.getSuperclass();
                } while (c1 != null && !c1.isAssignableFrom(c2));

                if (c1 == null) {
                    return "java/lang/Object";
                }
                return c1.getName().replace('.', '/');
            } catch (Exception e) {
                return "java/lang/Object";
            }
        }
    }
}

