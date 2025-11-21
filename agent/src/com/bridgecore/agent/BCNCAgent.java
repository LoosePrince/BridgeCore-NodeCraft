package com.bridgecore.agent;

import com.bridgecore.agent.config.AgentConfig;
import com.bridgecore.agent.core.CommunicationClient;
import com.bridgecore.agent.core.MappingService;
import com.bridgecore.agent.core.Message;
import com.bridgecore.agent.core.MessageRouter;
import com.bridgecore.agent.core.MessageType;
import com.bridgecore.agent.exception.MappingException;
import com.bridgecore.agent.intercept.ChatInterceptModule;
import com.bridgecore.agent.intercept.InterceptEventDispatcher;
import com.bridgecore.agent.intercept.PlayerListInterceptModule;
import com.bridgecore.agent.intercept.RuleRegistry;
import com.bridgecore.agent.injection.*;
import com.bridgecore.agent.logging.AgentLogger;
import com.bridgecore.agent.utils.JsonUtils;
import com.bridgecore.agent.utils.VersionDetector;

import java.io.File;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.security.CodeSource;
import java.util.List;
import java.util.Map;
import java.util.jar.JarFile;

/**
 * BCNC Agent - 通用聊天拦截框架
 * 提供底层拦截能力，所有业务逻辑由 Node.js 端控制
 */
public class BCNCAgent {
    private static Instrumentation instrumentation;
    private static volatile boolean running = true;
    private static CommunicationClient communicationClient;
    private static MessageRouter messageRouter;
    private static MappingService mappingService;
    
    private static final RuleRegistry RULE_REGISTRY = ChatInterceptModule.getRuleRegistry();
    private static AgentConfig agentConfig;
    private static InterceptEventDispatcher interceptDispatcher;
    private static PlayerListInterceptModule.PlayerListEventDispatcher playerListDispatcher;
    static final String METHOD_HANDLE_KEY = "bcnc.agent.interceptHandle";
    static final String PLAYER_LIST_HANDLE_KEY = "bcnc.agent.playerListHandle";

    /**
     * 通知 Node.js 拦截事件
     */
    private static void notifyIntercepted(String ruleId, String message, Map<String, String> playerInfo) {
        String playerName = playerInfo.getOrDefault("playerName", "Unknown");
        String data = ruleId + "|" + message + "|" + playerName;
        sendMessage(MessageType.CHAT_INTERCEPTED, data);
    }

    private static void registerMethodHandle() {
        try {
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            MethodType type = MethodType.methodType(boolean.class, String.class, Object.class);
            MethodHandle handle = lookup.findStatic(ChatInterceptModule.class, "handleChat", type);
            System.getProperties().put(METHOD_HANDLE_KEY, handle);
            AgentLogger.debug("注册聊天拦截 MethodHandle");
        } catch (Throwable t) {
            AgentLogger.error("注册聊天拦截 MethodHandle 失败: " + t.getMessage(), t);
        }
    }

    private static void registerPlayerListMethodHandle() {
        try {
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            MethodType type = MethodType.methodType(boolean.class, Object.class);
            MethodHandle handle = lookup.findStatic(PlayerListInterceptModule.class, "handlePlayerList", type);
            System.getProperties().put(PLAYER_LIST_HANDLE_KEY, handle);
            AgentLogger.debug("注册玩家列表拦截 MethodHandle");
        } catch (Throwable t) {
            AgentLogger.error("注册玩家列表拦截 MethodHandle 失败: " + t.getMessage(), t);
        }
    }
    
    private static void initializeInterceptModule() {
        interceptDispatcher = BCNCAgent::notifyIntercepted;
        ChatInterceptModule.initialize(interceptDispatcher);
    }

    private static void initializePlayerListInterceptModule() {
        playerListDispatcher = BCNCAgent::notifyPlayerListUpdated;
        PlayerListInterceptModule.initialize(playerListDispatcher);
    }

    /**
     * 通知 Node.js 玩家列表更新事件
     */
    private static void notifyPlayerListUpdated(List<Map<String, String>> players) {
        try {
            // 将玩家列表转换为 JSON 格式
            StringBuilder json = new StringBuilder();
            json.append("[");
            for (int i = 0; i < players.size(); i++) {
                Map<String, String> player = players.get(i);
                if (i > 0) {
                    json.append(",");
                }
                json.append("{");
                json.append("\"name\":\"").append(escapeJson(player.getOrDefault("playerName", "Unknown"))).append("\",");
                json.append("\"uuid\":\"").append(escapeJson(player.getOrDefault("playerUuid", "Unknown"))).append("\"");
                json.append("}");
            }
            json.append("]");
            sendMessage(MessageType.PLAYER_LIST_UPDATED, json.toString());
        } catch (Exception e) {
            AgentLogger.error("发送玩家列表更新消息失败: " + e.getMessage(), e);
        }
    }

    private static String escapeJson(String str) {
        if (str == null) {
            return "";
        }
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
    
    /**
     * Agent 入口点 - 动态附加时调用
     */
    public static void agentmain(String args, Instrumentation inst) throws Exception {
        AgentLogger.initializeFromSystem();
        AgentLogger.info("JVM 版本: " + System.getProperty("java.version"));
        AgentLogger.debug("参数: " + args);
        
        instrumentation = inst;
        agentConfig = AgentConfig.fromArgs(args);
        AgentLogger.debug("通信配置: " + agentConfig.getHost() + ":" + agentConfig.getPort());
        running = true;
        
        if (communicationClient != null) {
            communicationClient.stop();
        }
        
        // 确保 Agent 对游戏类加载器可见
        ensureAgentVisibleToGame(inst);
        
        // 验证类可见性（调试用）
        verifyClassVisibility(inst);
        
        // 初始化拦截模块
        initializeInterceptModule();
        initializePlayerListInterceptModule();
        
        // 注册 MethodHandle
        registerMethodHandle();
        registerPlayerListMethodHandle();
        
        // 检测服务端类型
        AgentLogger.debug("正在检测服务端类型...");
        ServerType serverType = ServerType.detect(instrumentation);
        AgentLogger.info("检测到服务端类型: " + serverType.getDisplayName());
        
        String detectedVersion = VersionDetector.detectVersion();
        
        // 启动通信服务
        AgentLogger.debug("正在启动通信服务 (目标: " + agentConfig.getHost() + ":" + agentConfig.getPort() + ")...");
        startCommunication(agentConfig, inst);
        
        // 发送服务器元数据
        sendServerMetadata(serverType, detectedVersion);
        
        // 准备映射文件
        try {
            mappingService.prepareMappings(serverType, detectedVersion, agentConfig);
        } catch (MappingException e) {
            AgentLogger.warn("映射文件准备失败，将尝试继续: " + e.getMessage());
            // 不中断初始化流程，允许在无映射文件的情况下继续
        }
        
        // 安装聊天拦截器
        AgentLogger.debug("正在安装聊天消息拦截器...");
        installChatInterceptor(serverType);
        
        // 安装玩家列表拦截器
        AgentLogger.debug("正在安装玩家列表拦截器...");
        installPlayerListInterceptor(serverType);
        
        AgentLogger.info("Agent 初始化完成");
    }
    
    /**
     * Agent 预加载入口点 - JVM启动时通过 -javaagent 参数加载
     */
    public static void premain(String args, Instrumentation inst) throws Exception {
        AgentLogger.info("Agent通过premain加载");
        agentmain(args, inst);
    }
    
    /**
     * 安装聊天拦截器
     */
    private static void installChatInterceptor(ServerType serverType) {
        try {
            // 获取注入配置
            File mappingFile = agentConfig != null ? agentConfig.getMappingFile() : null;
            InjectionConfig config = InjectionConfig.getDefaultConfig(serverType, mappingFile);
            
            // 创建类定位器
            ClassLocator classLocator = new ClassLocator(instrumentation, config);
            
            // 创建并注册 ClassFileTransformer
            ClassFileTransformer transformer = new ChatInterceptorTransformer(config);
            instrumentation.addTransformer(transformer, true);
            
            AgentLogger.debug("已注册字节码转换器");
            
            // 使用 ClassLocator 查找目标类
            List<Class<?>> targetClasses = classLocator.locateTargetClasses();
            
            if (targetClasses.isEmpty()) {
                AgentLogger.warn("未找到目标处理器类（忽略）");
                AgentLogger.debug("目标类名: " + config.getTargetClassNames());
                AgentLogger.debug("注意: 如果未找到目标类，它们可能在玩家连接时才会加载。Transformer 已注册，将在类首次加载时拦截。");
                return;
            }
            
            AgentLogger.debug("找到 " + targetClasses.size() + " 个候选类");
            
            // 转换所有可修改的类
            int transformedCount = 0;
            for (Class<?> clazz : targetClasses) {
                String name = clazz.getName();
                
                if (classLocator.isModifiable(clazz)) {
                    AgentLogger.debug("正在转换: " + name);
                    try {
                        instrumentation.retransformClasses(clazz);
                        transformedCount++;
                        AgentLogger.debug("转换成功: " + name);
                    } catch (Exception e) {
                        AgentLogger.error("转换失败: " + e.getMessage(), e);
                    }
                } else {
                    AgentLogger.debug("类不可修改: " + name);
                }
            }
            
            if (transformedCount > 0) {
                AgentLogger.debug("转换了 " + transformedCount + " 个类，拦截器已就绪");
            } else {
                AgentLogger.warn("未找到可修改的聊天处理类");
            }
            
        } catch (Exception e) {
            AgentLogger.error("安装拦截器失败: " + e.getMessage(), e);
        }
    }

    /**
     * 安装玩家列表拦截器
     */
    private static void installPlayerListInterceptor(ServerType serverType) {
        try {
            // 获取注入配置
            File mappingFile = agentConfig != null ? agentConfig.getMappingFile() : null;
            InjectionConfig config = InjectionConfig.getPlayerListConfig(serverType, mappingFile);
            
            // 创建类定位器
            ClassLocator classLocator = new ClassLocator(instrumentation, config);
            
            // 创建并注册 ClassFileTransformer
            ClassFileTransformer transformer = new PlayerListInterceptorTransformer(config);
            instrumentation.addTransformer(transformer, true);
            
            AgentLogger.debug("已注册玩家列表字节码转换器");
            
            // 使用 ClassLocator 查找目标类
            List<Class<?>> targetClasses = classLocator.locateTargetClasses();
            
            if (targetClasses.isEmpty()) {
                AgentLogger.warn("未找到目标玩家列表类（忽略）");
                AgentLogger.debug("目标类名: " + config.getTargetClassNames());
                AgentLogger.debug("注意: 如果未找到目标类，它们可能在服务器启动时才会加载。Transformer 已注册，将在类首次加载时拦截。");
                return;
            }
            
            AgentLogger.debug("找到 " + targetClasses.size() + " 个候选玩家列表类");
            
            // 转换所有可修改的类
            int transformedCount = 0;
            for (Class<?> clazz : targetClasses) {
                String name = clazz.getName();
                
                if (classLocator.isModifiable(clazz)) {
                    AgentLogger.debug("正在转换玩家列表类: " + name);
                    try {
                        instrumentation.retransformClasses(clazz);
                        transformedCount++;
                        AgentLogger.debug("转换成功: " + name);
                    } catch (Exception e) {
                        AgentLogger.error("转换失败: " + e.getMessage(), e);
                    }
                } else {
                    AgentLogger.debug("类不可修改: " + name);
                }
            }
            
            if (transformedCount > 0) {
                AgentLogger.debug("转换了 " + transformedCount + " 个玩家列表类，拦截器已就绪");
            } else {
                AgentLogger.warn("未找到可修改的玩家列表类");
            }
            
        } catch (Exception e) {
            AgentLogger.error("安装玩家列表拦截器失败: " + e.getMessage(), e);
        }
    }
    
    /**
     * 验证类可见性（调试用）
     */
    private static void verifyClassVisibility(Instrumentation inst) {
        try {
            Class<?>[] allClasses = inst.getAllLoadedClasses();
            Class<?> handlerClass = null;
            
            for (Class<?> clazz : allClasses) {
                if (clazz.getName().contains("ServerPlayNetworkHandler")) {
                    handlerClass = clazz;
                    break;
                }
            }
            
            if (handlerClass != null) {
                AgentLogger.debug("ServerPlayNetworkHandler 的类加载器: " + handlerClass.getClassLoader());
                
                try {
                    Class.forName("com.bridgecore.agent.BCNCAgent", false, handlerClass.getClassLoader());
                } catch (ClassNotFoundException e) {
                    AgentLogger.warn("无法通过 ServerPlayNetworkHandler 的类加载器加载 BCNCAgent: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            AgentLogger.warn("验证类可见性失败: " + e.getMessage());
        }
    }
    
    /**
     * 确保 BCNCAgent 对游戏类加载器可见
     */
    private static void ensureAgentVisibleToGame(Instrumentation inst) {
        try {
            CodeSource codeSource = BCNCAgent.class.getProtectionDomain().getCodeSource();
            if (codeSource == null) {
                AgentLogger.warn("无法获取 Agent JAR 位置，可能会导致类不可见");
                return;
            }
            File jarFile = new File(codeSource.getLocation().toURI());
            if (!jarFile.isFile()) {
                AgentLogger.warn("Agent 位置不是文件: " + jarFile);
                return;
            }

            JarFile jarForSystem = new JarFile(jarFile);
            inst.appendToSystemClassLoaderSearch(jarForSystem);
            AgentLogger.debug("已将 Agent JAR 加入 System ClassLoader 搜索路径");
        } catch (Exception e) {
            AgentLogger.warn("无法将 Agent JAR 添加到 System ClassLoader: " + e.getMessage());
        }
    }
    
    /**
     * 启动与 Node.js 的通信
     */
    private static void startCommunication(AgentConfig config, Instrumentation inst) {
        // 创建消息发送器（需要在创建 CommunicationClient 之前定义）
        java.util.function.Consumer<String> messageSender = json -> {
            if (communicationClient != null) {
                communicationClient.send(json);
            } else {
                AgentLogger.warn("通信客户端尚未初始化，丢弃消息");
            }
        };
        
        // 创建消息路由器
        messageRouter = new MessageRouter(
            RULE_REGISTRY,
            instrumentation,
            messageSender,
            () -> {
                running = false;
                if (communicationClient != null) {
                    communicationClient.stop();
                }
            }
        );
        
        // 创建映射服务
        mappingService = new MappingService(messageSender);
        
        // 创建通信客户端，包装消息处理以支持映射服务
        CommunicationClient.MessageHandler wrappedHandler = message -> {
            Message msg = Message.fromJson(message);
            if (msg.hasType()) {
                if (msg.getType() == MessageType.MAPPING_READY) {
                    mappingService.handleMappingReady(msg.getData());
                } else if (msg.getType() == MessageType.MAPPING_FAILED) {
                    mappingService.handleMappingFailed(msg.getData());
                } else {
                    messageRouter.handle(message);
                }
            } else {
                messageRouter.handle(message);
            }
        };
        
        communicationClient = new CommunicationClient(config, wrappedHandler);
        // 设置映射服务的通信客户端引用
        mappingService.setCommunicationClient(communicationClient);
        communicationClient.start();
        
        // 发送初始消息
        sendMessage(MessageType.AGENT_READY, "Agent已就绪");
        sendMessage(MessageType.SERVER_INFO, getServerInfo(inst));
    }
    
    /**
     * 发送服务器元数据
     */
    private static void sendServerMetadata(ServerType serverType, String version) {
        try {
            String payload = JsonUtils.buildObject(
                JsonUtils.KEY_SERVER_TYPE, serverType.name(),
                JsonUtils.KEY_SERVER_TYPE_DISPLAY, serverType.getDisplayName(),
                JsonUtils.KEY_VERSION, version != null ? version : ""
            );
            sendMessage(MessageType.SERVER_METADATA, payload);
        } catch (Exception e) {
            AgentLogger.warn("构建服务端元数据失败: " + e.getMessage());
        }
    }
    
    /**
     * 获取服务器信息
     */
    private static String getServerInfo(Instrumentation inst) {
        StringBuilder sb = new StringBuilder();
        sb.append("Loaded Classes: ").append(inst.getAllLoadedClasses().length);
        sb.append(", Retransform Capable: ").append(inst.isRetransformClassesSupported());
        sb.append(", Redefine Capable: ").append(inst.isRedefineClassesSupported());
        return sb.toString();
    }
    
    /**
     * 发送消息到 Node.js
     */
    private static void sendMessage(MessageType type, String data) {
        if (communicationClient == null) {
            AgentLogger.warn("通信客户端尚未初始化，丢弃消息: " + type);
            return;
        }
        String json = Message.of(type, data).toJson();
        communicationClient.send(json);
    }
}
