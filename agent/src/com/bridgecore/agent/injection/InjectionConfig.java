package com.bridgecore.agent.injection;

import com.bridgecore.agent.intercept.ChatInterceptModule;
import com.bridgecore.agent.intercept.PlayerInfoExtractor;
import com.bridgecore.agent.logging.AgentLogger;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 注入配置 - 定义不同版本和服务端的类名和方法签名
 */
public class InjectionConfig {
    private final ServerType serverType;
    private final List<String> targetClassNames;
    private final MethodSignature targetMethod;
    private final MappingResolver mappingResolver;

    public InjectionConfig(ServerType serverType, List<String> targetClassNames, MethodSignature targetMethod) {
        this(serverType, targetClassNames, targetMethod, null);
    }

    public InjectionConfig(ServerType serverType, List<String> targetClassNames, MethodSignature targetMethod, File mappingFile) {
        this.serverType = serverType;
        this.targetClassNames = new ArrayList<>(targetClassNames);
        this.targetMethod = targetMethod;
        this.mappingResolver = new MappingResolver();
        
        // 尝试加载映射文件
        File effectiveMapping = mappingFile != null ? mappingFile : new File("server.txt");
        if (effectiveMapping.exists()) {
            this.mappingResolver.loadMapping(effectiveMapping);
            resolveMappedClasses();
            
            // 配置 PlayerInfoExtractor 使用映射解析器
            ChatInterceptModule.setPlayerInfoExtractor(new PlayerInfoExtractor(this.mappingResolver));
        } else {
            AgentLogger.warn("未找到 server.txt 映射文件，某些原版服务端可能无法完成注入");
        }
    }

    private void resolveMappedClasses() {
        List<String> mappedNames = new ArrayList<>();
        
        // 关键类：ServerGamePacketListenerImpl (原版聊天处理的核心类)
        String[] keyClasses = {
            "net.minecraft.server.network.ServerGamePacketListenerImpl",
            "net.minecraft.server.network.ServerPlayNetworkHandler"
        };
        
        for (String className : keyClasses) {
            String obfuscated = mappingResolver.getObfuscatedClassName(className);
            if (obfuscated != null) {
                AgentLogger.debug("找到映射: " + className + " -> " + obfuscated);
                mappedNames.add(obfuscated);
            }
        }
        
        // 也检查已有的类名
        for (String className : targetClassNames) {
            String obfuscated = mappingResolver.getObfuscatedClassName(className);
            if (obfuscated != null) {
                AgentLogger.debug("找到映射: " + className + " -> " + obfuscated);
                mappedNames.add(obfuscated);
            }
        }
        
        targetClassNames.addAll(mappedNames);
    }

    public ServerType getServerType() {
        return serverType;
    }

    public List<String> getTargetClassNames() {
        return new ArrayList<>(targetClassNames);
    }

    public MethodSignature getTargetMethod() {
        return targetMethod;
    }

    /**
     * 方法签名
     */
    public static class MethodSignature {
        private final String namePattern;
        private final String descriptorPattern;
        private final int parameterIndex; // 消息参数在方法参数中的索引

        public MethodSignature(String namePattern, String descriptorPattern, int parameterIndex) {
            this.namePattern = namePattern;
            this.descriptorPattern = descriptorPattern;
            this.parameterIndex = parameterIndex;
        }

        public String getNamePattern() {
            return namePattern;
        }

        public String getDescriptorPattern() {
            return descriptorPattern;
        }

        public int getParameterIndex() {
            return parameterIndex;
        }

        /**
         * 检查方法名是否匹配
         */
        public boolean matchesName(String methodName) {
            if (namePattern.contains("*")) {
                String regex = namePattern.replace("*", ".*");
                return methodName.matches(regex);
            }
            return methodName.equals(namePattern);
        }

        /**
         * 检查方法描述符是否匹配
         */
        public boolean matchesDescriptor(String descriptor) {
            if (descriptorPattern == null || descriptorPattern.isEmpty()) {
                return true; // 不限制描述符
            }
            if (descriptorPattern.contains("*")) {
                String regex = descriptorPattern.replace("*", ".*");
                return descriptor.matches(regex);
            }
            return descriptor.contains(descriptorPattern);
        }
    }

    /**
     * 获取默认配置（Fabric 1.21）
     */
    public static InjectionConfig getDefaultConfig(ServerType serverType) {
        return getDefaultConfig(serverType, null);
    }

    public static InjectionConfig getDefaultConfig(ServerType serverType, File mappingFile) {
        List<String> classNames = new ArrayList<>();
        MethodSignature methodSig;

        switch (serverType) {
            case FABRIC:
            case QUILT:
                // Fabric/Quilt: 使用映射后的类名
                classNames.add("net.minecraft.server.network.ServerPlayNetworkHandler");
                classNames.add("net.minecraft.class_3244"); // 混淆名
                // 查找处理聊天消息的方法（通常包含 String 参数）
                methodSig = new MethodSignature("*", "*Ljava/lang/String;*", 0);
                break;

            case FORGE:
                // Forge: 类似 Fabric，但可能有不同的包名
                classNames.add("net.minecraft.server.network.ServerGamePacketListenerImpl");
                classNames.add("net.minecraft.server.network.ServerPlayNetworkHandler");
                classNames.add("net.minecraft.class_3244");
                methodSig = new MethodSignature("*", "*Ljava/lang/String;*", 0);
                break;

            case PAPER:
            case SPIGOT:
            case BUKKIT:
                // Paper/Spigot/Bukkit: 使用 Bukkit API 和 NMS
                // Paper 基于原版，所以也包含 ServerGamePacketListenerImpl
                classNames.add("net.minecraft.server.network.ServerGamePacketListenerImpl");
                classNames.add("net.minecraft.server.network.ServerPlayNetworkHandler");
                // CraftBukkit 可能使用版本化的包名，添加模糊匹配
                classNames.add("*ServerPlayNetworkHandler");
                classNames.add("*ServerGamePacketListenerImpl");
                methodSig = new MethodSignature("*", "*Ljava/lang/String;*", 0);
                break;

            case VANILLA:
            default:
                // 原版: 使用映射文件解析混淆类名
                // ServerGamePacketListenerImpl 是真正的聊天处理类
                classNames.add("net.minecraft.server.network.ServerGamePacketListenerImpl");
                classNames.add("net.minecraft.server.network.ServerPlayNetworkHandler");
                // 方法签名：匹配 handleChat 方法
                // handleChat(ServerboundChatPacket) 或其他包含 String 的聊天方法
                methodSig = new MethodSignature("*", "*", 0);
                break;
        }

        return new InjectionConfig(serverType, classNames, methodSig, mappingFile);
    }
}

