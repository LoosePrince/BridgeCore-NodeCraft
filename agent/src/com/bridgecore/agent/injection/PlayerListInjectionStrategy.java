package com.bridgecore.agent.injection;

import org.objectweb.asm.*;

/**
 * 玩家列表注入策略 - 负责在返回玩家列表的方法中插入拦截代码
 */
public class PlayerListInjectionStrategy {
    private static final String METHOD_HANDLE_KEY = "bcnc.agent.playerListHandle";

    /**
     * 创建方法访问器，用于注入拦截代码
     */
    public MethodVisitor createMethodVisitor(MethodVisitor mv, int access, 
                                             String name, String descriptor,
                                             MethodLocator.MethodInfo methodInfo,
                                             MethodLocator methodLocator) {
        return new PlayerListInjectionMethodVisitor(mv, access, name, descriptor, methodInfo, methodLocator);
    }

    /**
     * 注入方法访问器
     */
    private static class PlayerListInjectionMethodVisitor extends org.objectweb.asm.commons.AdviceAdapter {
        private final MethodLocator.MethodInfo methodInfo;
        private final MethodLocator methodLocator;
        private final org.objectweb.asm.Type returnType;
        private int returnVar = -1;
        private boolean shouldIntercept = false;

        public PlayerListInjectionMethodVisitor(MethodVisitor mv, int access, String name, 
                                     String descriptor, MethodLocator.MethodInfo methodInfo,
                                     MethodLocator methodLocator) {
            super(Opcodes.ASM9, mv, access, name, descriptor);
            this.methodInfo = methodInfo;
            this.methodLocator = methodLocator;
            this.returnType = org.objectweb.asm.Type.getReturnType(descriptor);
            
            // 检查返回类型是否是集合类型
            String returnTypeName = returnType.getInternalName();
            this.shouldIntercept = returnTypeName.equals("java/util/Collection") ||
                                 returnTypeName.equals("java/util/List") ||
                                 returnType.getSort() == org.objectweb.asm.Type.ARRAY;
        }

        @Override
        protected void onMethodExit(int opcode) {
            // 只在方法正常返回时拦截（不是抛出异常）
            if (opcode != Opcodes.ARETURN || !shouldIntercept) {
                super.onMethodExit(opcode);
                return;
            }

            // 此时返回值在栈顶，保存到局部变量
            returnVar = newLocal(returnType);
            mv.visitVarInsn(Opcodes.ASTORE, returnVar);

            // 注入拦截代码（确保执行后栈为空）
            injectInterceptionCode(returnVar);
            
            // 恢复返回值到栈顶
            mv.visitVarInsn(Opcodes.ALOAD, returnVar);
            
            // 调用父类方法生成返回指令
            super.onMethodExit(opcode);
        }
        

        /**
         * 注入拦截代码
         * 注意：此方法执行后，栈必须为空
         */
        private void injectInterceptionCode(int returnVar) {
            Label skipLabel = new Label();
            Label endLabel = new Label();
            
            // Properties props = System.getProperties();
            mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", 
                             "()Ljava/util/Properties;", false);
            
            // Object handleObj = props.get("bcnc.agent.playerListHandle");
            mv.visitLdcInsn(METHOD_HANDLE_KEY);
            mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", 
                             "(Ljava/lang/Object;)Ljava/lang/Object;", false);
            
            // if (handleObj == null) goto skip
            mv.visitInsn(Opcodes.DUP);
            mv.visitJumpInsn(Opcodes.IFNULL, skipLabel);
            
            // if (!(handleObj instanceof MethodHandle)) goto skip
            mv.visitInsn(Opcodes.DUP);
            mv.visitTypeInsn(Opcodes.INSTANCEOF, "java/lang/invoke/MethodHandle");
            mv.visitJumpInsn(Opcodes.IFEQ, skipLabel);
            
            // MethodHandle mh = (MethodHandle) handleObj;
            mv.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/invoke/MethodHandle");
            
            // Object[] args = new Object[]{returnValue};
            mv.visitInsn(Opcodes.ICONST_1);
            mv.visitTypeInsn(Opcodes.ANEWARRAY, "java/lang/Object");
            mv.visitInsn(Opcodes.DUP);
            mv.visitInsn(Opcodes.ICONST_0);
            mv.visitVarInsn(Opcodes.ALOAD, returnVar); // 加载返回值
            mv.visitInsn(Opcodes.AASTORE);
            
            // Object result = mh.invokeWithArguments(args);
            mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/invoke/MethodHandle", "invokeWithArguments", 
                             "([Ljava/lang/Object;)Ljava/lang/Object;", false);
            mv.visitInsn(Opcodes.POP); // 忽略返回值，栈为空
            mv.visitJumpInsn(Opcodes.GOTO, endLabel);
            
            mv.visitLabel(skipLabel);
            mv.visitInsn(Opcodes.POP); // 弹出 handleObj，栈为空
            
            mv.visitLabel(endLabel);
            // 此时栈必须为空
        }
    }
}

