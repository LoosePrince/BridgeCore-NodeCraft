package com.bridgecore.agent.injection;

import org.objectweb.asm.*;

/**
 * 代码注入策略 - 负责在方法中插入拦截代码
 */
public class CodeInjectionStrategy {
    private static final String METHOD_HANDLE_KEY = "bcnc.agent.interceptHandle";

    /**
     * 创建方法访问器，用于注入拦截代码
     */
    public MethodVisitor createMethodVisitor(MethodVisitor mv, int access, 
                                             String name, String descriptor,
                                             MethodLocator.MethodInfo methodInfo,
                                             MethodLocator methodLocator) {
        return new InjectionMethodVisitor(mv, access, name, descriptor, methodInfo, methodLocator);
    }

    /**
     * 注入方法访问器
     */
    private static class InjectionMethodVisitor extends org.objectweb.asm.commons.AdviceAdapter {
        private final MethodLocator.MethodInfo methodInfo;
        private final MethodLocator methodLocator;
        private final int messageVarIndex;

        public InjectionMethodVisitor(MethodVisitor mv, int access, String name, 
                                     String descriptor, MethodLocator.MethodInfo methodInfo,
                                     MethodLocator methodLocator) {
            super(Opcodes.ASM9, mv, access, name, descriptor);
            this.methodInfo = methodInfo;
            this.methodLocator = methodLocator;
            this.messageVarIndex = methodLocator.computeMessageVarIndex(descriptor, methodInfo.isStatic());
        }

        @Override
        protected void onMethodEnter() {
            if (messageVarIndex < 0) {
                return; // 未找到消息参数，跳过注入
            }

            Label continueLabel = new Label();
            injectInterceptionCode(continueLabel);
            mv.visitLabel(continueLabel);
        }

        /**
         * 注入拦截代码
         */
        private void injectInterceptionCode(Label continueLabel) {
            // try-catch 块覆盖整个拦截逻辑
            Label tryStart = new Label();
            Label tryEnd = new Label();
            Label catchLabel = new Label();
            mv.visitTryCatchBlock(tryStart, tryEnd, catchLabel, "java/lang/Throwable");

            mv.visitLabel(tryStart);

            // Properties props = System.getProperties();
            mv.visitMethodInsn(INVOKESTATIC, "java/lang/System", "getProperties", 
                             "()Ljava/util/Properties;", false);
            
            // Object handleObj = props.get("bcnc.agent.interceptHandle");
            mv.visitLdcInsn(METHOD_HANDLE_KEY);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/util/Properties", "get", 
                             "(Ljava/lang/Object;)Ljava/lang/Object;", false);
            
            // if (handleObj == null) goto end
            mv.visitInsn(DUP);
            Label nullCheck = new Label();
            mv.visitJumpInsn(IFNULL, nullCheck);
            
            // if (!(handleObj instanceof MethodHandle)) goto end
            mv.visitInsn(DUP);
            mv.visitTypeInsn(INSTANCEOF, "java/lang/invoke/MethodHandle");
            Label notHandle = new Label();
            mv.visitJumpInsn(IFEQ, notHandle);
            
            // MethodHandle mh = (MethodHandle) handleObj;
            mv.visitTypeInsn(CHECKCAST, "java/lang/invoke/MethodHandle");
            
            // Object[] args = new Object[]{message, this};
            mv.visitInsn(ICONST_2);
            mv.visitTypeInsn(ANEWARRAY, "java/lang/Object");
            mv.visitInsn(DUP);
            mv.visitInsn(ICONST_0);
            mv.visitVarInsn(ALOAD, messageVarIndex); // 加载 message 参数
            mv.visitInsn(AASTORE);
            mv.visitInsn(DUP);
            mv.visitInsn(ICONST_1);
            if (!methodInfo.isStatic()) {
                mv.visitVarInsn(ALOAD, 0); // 加载 this
            } else {
                mv.visitInsn(ACONST_NULL);
            }
            mv.visitInsn(AASTORE);
            
            // Object result = mh.invokeWithArguments(args);
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/invoke/MethodHandle", "invokeWithArguments", 
                             "([Ljava/lang/Object;)Ljava/lang/Object;", false);
            
            // if (result instanceof Boolean && ((Boolean)result).booleanValue() == true) return;
            mv.visitInsn(DUP);
            mv.visitTypeInsn(INSTANCEOF, "java/lang/Boolean");
            Label notBoolean = new Label();
            mv.visitJumpInsn(IFEQ, notBoolean);
            
            mv.visitTypeInsn(CHECKCAST, "java/lang/Boolean");
            mv.visitMethodInsn(INVOKEVIRTUAL, "java/lang/Boolean", "booleanValue", "()Z", false);
            Label notTrue = new Label();
            mv.visitJumpInsn(IFEQ, notTrue);
            
            // 拦截成功，直接返回
            // 根据方法返回类型返回适当的值
            org.objectweb.asm.Type returnType = org.objectweb.asm.Type.getReturnType(methodInfo.getDescriptor());
            if (returnType == org.objectweb.asm.Type.VOID_TYPE) {
            mv.visitInsn(RETURN);
            } else if (returnType == org.objectweb.asm.Type.BOOLEAN_TYPE) {
                mv.visitInsn(ICONST_0); // 返回 false
                mv.visitInsn(IRETURN);
            } else if (returnType == org.objectweb.asm.Type.INT_TYPE) {
                mv.visitInsn(ICONST_0); // 返回 0
                mv.visitInsn(IRETURN);
            } else {
                mv.visitInsn(ACONST_NULL); // 返回 null
                mv.visitInsn(ARETURN);
            }
            
            mv.visitLabel(notTrue);
            mv.visitJumpInsn(GOTO, tryEnd);
            
            mv.visitLabel(notBoolean);
            mv.visitInsn(POP);
            mv.visitJumpInsn(GOTO, tryEnd);
            
            mv.visitLabel(notHandle);
            mv.visitInsn(POP);
            mv.visitJumpInsn(GOTO, tryEnd);
            
            mv.visitLabel(nullCheck);
            mv.visitInsn(POP);

            mv.visitLabel(tryEnd);
            mv.visitJumpInsn(GOTO, continueLabel);

            // catch (Throwable t)
            mv.visitLabel(catchLabel);
            int throwableLocal = newLocal(org.objectweb.asm.Type.getType(Throwable.class));
            mv.visitVarInsn(ASTORE, throwableLocal);
            mv.visitLdcInsn("[BCNC Agent] 拦截代码执行出错: " + methodInfo.getName() + methodInfo.getDescriptor());
            mv.visitVarInsn(ALOAD, throwableLocal);
            mv.visitMethodInsn(INVOKESTATIC,
                    "com/bridgecore/agent/logging/AgentLogger",
                    "error",
                    "(Ljava/lang/String;Ljava/lang/Throwable;)V",
                    false);
            mv.visitJumpInsn(GOTO, continueLabel);
        }
    }
}

