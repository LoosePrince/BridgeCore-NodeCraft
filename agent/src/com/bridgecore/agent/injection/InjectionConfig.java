package com.bridgecore.agent.injection;

import com.bridgecore.agent.intercept.ChatInterceptModule;
import com.bridgecore.agent.intercept.PlayerInfoExtractor;
import com.bridgecore.agent.logging.AgentLogger;
import com.bridgecore.agent.utils.MappingDownloader;
import com.bridgecore.agent.utils.VersionDetector;
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
        this.serverType = serverType;
        this.targetClassNames = new ArrayList<>(targetClassNames);
        this.targetMethod = targetMethod;
        this.mappingResolver = new MappingResolver();
        
        // 尝试加载映射文件
        java.io.File mappingFile = new java.io.File("server.txt"); // 默认查找当前目录下的 server.txt
        
        // 如果是原版服务端且没有映射文件，尝试自动下载
        if (!mappingFile.exists() && serverType == ServerType.VANILLA) {
            String version = VersionDetector.detectVersion();
            if (version != null) {
                AgentLogger.info("开始下载" + version + "的映射表");
                MappingDownloader.downloadMappings(version, mappingFile);
            } else {
                AgentLogger.warn("未能检测到 Minecraft 版本，跳过自动下载映射表");
                AgentLogger.warn("请手动下载映射表并放置在服务器目录下，文件名为 server.txt");
            }
        }

        if (mappingFile.exists()) {
            this.mappingResolver.loadMapping(mappingFile);
            resolveMappedClasses();
            
            // 配置 PlayerInfoExtractor 使用映射解析器
            ChatInterceptModule.setPlayerInfoExtractor(new PlayerInfoExtractor(this.mappingResolver));
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
                // Paper/Spigot/Bukkit: 使用 Bukkit API
                classNames.add("net.minecraft.server.network.ServerPlayNetworkHandler");
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

        return new InjectionConfig(serverType, classNames, methodSig);
    }
}

