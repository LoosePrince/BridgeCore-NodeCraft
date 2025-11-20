package com.bridgecore.agent;

import com.bridgecore.agent.intercept.ChatInterceptModule;
import com.bridgecore.agent.intercept.InterceptEventDispatcher;
import com.bridgecore.agent.intercept.InterceptRule;
import com.bridgecore.agent.intercept.RuleRegistry;
import com.bridgecore.agent.injection.*;
import com.bridgecore.agent.logging.AgentLogger;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.net.Socket;
import java.security.CodeSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.jar.JarFile;

/**
 * BCNC Agent - 通用聊天拦截框架
 * 提供底层拦截能力，所有业务逻辑由 Node.js 端控制
 */
public class BCNCAgent {
    private static Instrumentation instrumentation;
    private static Socket socket;
    private static PrintWriter out;
    private static BufferedReader in;
    private static volatile boolean running = true;
    private static Thread communicationThread;
    
    private static final RuleRegistry RULE_REGISTRY = ChatInterceptModule.getRuleRegistry();
    private static InterceptEventDispatcher interceptDispatcher;
    static final String METHOD_HANDLE_KEY = "bcnc.agent.interceptHandle";
    /**
     * 通知 Node.js 拦截事件
     */
    private static void notifyIntercepted(String ruleId, String message, Map<String, String> playerInfo) {
        String playerName = playerInfo.getOrDefault("playerName", "Unknown");
        String data = ruleId + "|" + message + "|" + playerName;
        sendMessage("CHAT_INTERCEPTED", data);
    }

    private static void registerMethodHandle() {
        try {
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            MethodType type = MethodType.methodType(boolean.class, String.class, Object.class);
            MethodHandle handle = lookup.findStatic(ChatInterceptModule.class, "handleChat", type);
            System.getProperties().put(METHOD_HANDLE_KEY, handle);
            AgentLogger.info("注册 MethodHandle");
        } catch (Throwable t) {
            AgentLogger.error("注册 MethodHandle 失败: " + t.getMessage(), t);
        }
    }
    
    private static void initializeInterceptModule() {
        interceptDispatcher = BCNCAgent::notifyIntercepted;
        ChatInterceptModule.initialize(interceptDispatcher);
    }
    
    /**
     * Agent 入口点 - 动态附加时调用
     */
    public static void agentmain(String args, Instrumentation inst) throws Exception {
        AgentLogger.initializeFromSystem();
        AgentLogger.info("JVM 版本: " + System.getProperty("java.version"));
        AgentLogger.debug("参数: " + args);
        
        instrumentation = inst;
        running = true;
        if (communicationThread != null && communicationThread.isAlive()) {
            communicationThread.interrupt();
        }
        
        // 解析端口
        int port = parsePort(args);
        
        // 确保 Agent 对游戏类加载器可见
        ensureAgentVisibleToGame(inst);
        
        // 验证类可见性（调试用）
        verifyClassVisibility(inst);
        
        // 初始化拦截模块
        initializeInterceptModule();
        
        // 注册 MethodHandle
        registerMethodHandle();
        
        // 安装聊天拦截器
        AgentLogger.debug("正在安装聊天消息拦截器...");
        installChatInterceptor();
        
        // 启动通信线程
        AgentLogger.info("正在启动通信服务 (端口: " + port + ")...");
        startCommunication(port, inst);
        
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
     * 解析端口参数
     */
    private static int parsePort(String args) {
        int port = 25575; // 默认端口
        if (args != null && args.contains("port=")) {
            try {
                String portStr = args.substring(args.indexOf("port=") + 5);
                if (portStr.contains(" ")) {
                    portStr = portStr.substring(0, portStr.indexOf(" "));
                }
                port = Integer.parseInt(portStr);
            } catch (Exception e) {
                AgentLogger.warn("解析端口失败，使用默认端口: " + port);
            }
        }
        return port;
    }
    
    /**
     * 安装聊天拦截器
     */
    private static void installChatInterceptor() {
        try {
            AgentLogger.debug("正在检测服务端类型...");
            
            // 检测服务端类型
            ServerType serverType = ServerType.detect(instrumentation);
            AgentLogger.info("检测到服务端类型: " + serverType.getDisplayName());
            
            // 获取注入配置
            InjectionConfig config = InjectionConfig.getDefaultConfig(serverType);
            
            // 创建类定位器
            ClassLocator classLocator = new ClassLocator(instrumentation, config);
            
            // 创建并注册 ClassFileTransformer
            ClassFileTransformer transformer = new ChatInterceptorTransformer(config);
            instrumentation.addTransformer(transformer, true);
            
            AgentLogger.debug("已注册字节码转换器");
            
            // 使用 ClassLocator 查找目标类
            List<Class<?>> targetClasses = classLocator.locateTargetClasses();
            
            if (targetClasses.isEmpty()) {
                AgentLogger.warn("未找到目标处理器类");
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

            JarFile jarForBootstrap = new JarFile(jarFile);
            inst.appendToBootstrapClassLoaderSearch(jarForBootstrap);
            AgentLogger.debug("已将 Agent JAR 加入 Bootstrap ClassLoader");

            JarFile jarForSystem = new JarFile(jarFile);
            inst.appendToSystemClassLoaderSearch(jarForSystem);
            AgentLogger.debug("已将 Agent JAR 加入 System ClassLoader");
        } catch (Exception e) {
            AgentLogger.warn("无法将 Agent JAR 添加到引导类加载器: " + e.getMessage());
        }
    }
    
    /**
     * 启动与 Node.js 的通信
     */
    private static void startCommunication(int port, Instrumentation inst) {
        communicationThread = new Thread(() -> {
            try {
                Thread.sleep(500); // 稍等片刻让 Node.js 服务器启动
                
                socket = new Socket("127.0.0.1", port);
                out = new PrintWriter(socket.getOutputStream(), true);
                in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                
                AgentLogger.info("已连接到 Node.js 服务器");
                
                // 发送就绪消息
                sendMessage("AGENT_READY", "Agent已就绪");
                
                // 发送服务器信息
                String serverInfo = getServerInfo(inst);
                sendMessage("SERVER_INFO", serverInfo);
                
                // 接收和处理消息
                String message;
                while (running && (message = in.readLine()) != null) {
                    handleMessage(message);
                }
                
            } catch (Exception e) {
                if (running) {
                    AgentLogger.warn("通信错误: " + e.getMessage());
                }
            } finally {
                cleanup();
                communicationThread = null;
            }
        }, "BCNC-Agent-Communication");
        
        communicationThread.setDaemon(true);
        communicationThread.start();
    }
    
    /**
     * 处理来自 Node.js 的消息
     */
    private static void handleMessage(String message) {
        try {
            String type = extractJsonValue(message, "type");
            String data = extractJsonValue(message, "data");
            
            switch (type) {
                case "PING":
                    sendMessage("PONG", "Agent is alive");
                    AgentLogger.debug("收到 Ping 消息");
                    break;
                    
                case "GET_INFO":
                    String jvmInfo = getJVMInfo();
                    sendMessage("JVM_INFO", jvmInfo);
                    break;

                case "GET_JVM_INFO":
                    sendMessage("JVM_INFO", getJVMInfo());
                    break;

                case "GET_CLASSES":
                    if (instrumentation != null) {
                        String count = String.valueOf(instrumentation.getAllLoadedClasses().length);
                        sendMessage("CLASSES_COUNT", count);
                    } else {
                        sendMessage("CLASSES_COUNT", "N/A");
                    }
                    break;
                
                case "REGISTER_RULE":
                    // 注册拦截规则: data 格式 "id|pattern|matchType"
                    registerRule(data);
                    break;
                
                case "UNREGISTER_RULE":
                    // 注销拦截规则: data 是 ruleId
                    unregisterRule(data);
                    break;
                
                case "LIST_RULES":
                    // 列出所有规则
                    String rulesList = listRules();
                    sendMessage("RULES_LIST", rulesList);
                    break;
                
                case "CLEAR_RULES":
                    // 清空所有规则
                    clearRules();
                    sendMessage("RULES_CLEARED", "All rules cleared");
                    break;
                    
                case "SHUTDOWN":
                    AgentLogger.info("收到关闭命令");
                    running = false;
                    break;

                case "SET_LOG_LEVEL":
                    AgentLogger.setLevel(data);
                    sendMessage("LOG_LEVEL_UPDATED", data);
                    break;
                    
                default:
                    AgentLogger.debug("未知消息类型: " + type);
            }
            
        } catch (Exception e) {
            AgentLogger.warn("处理消息失败: " + e.getMessage());
        }
    }
    
    /**
     * 注册拦截规则
     */
    private static void registerRule(String data) {
        try {
            String[] parts = data.split("\\|", 3);
            if (parts.length < 3) {
                sendMessage("RULE_REGISTER_FAILED", "Invalid rule format: " + data);
                return;
            }
            
            String id = parts[0];
            String pattern = parts[1];
            InterceptRule.MatchType type = InterceptRule.MatchType.fromString(parts[2]);
            
            InterceptRule rule = new InterceptRule(id, pattern, type);
            RULE_REGISTRY.register(rule);
            
            AgentLogger.debug("注册规则: " + id + " (" + type.name().toLowerCase() + ": " + pattern + ")");
            sendMessage("RULE_REGISTERED", id);
            
        } catch (Exception e) {
            sendMessage("RULE_REGISTER_FAILED", e.getMessage());
        }
    }
    
    /**
     * 注销拦截规则
     */
    private static void unregisterRule(String ruleId) {
        if (RULE_REGISTRY.unregister(ruleId) != null) {
            AgentLogger.debug("注销规则: " + ruleId);
            sendMessage("RULE_UNREGISTERED", ruleId);
        } else {
            sendMessage("RULE_NOT_FOUND", ruleId);
        }
    }
    
    /**
     * 列出所有规则
     */
    private static String listRules() {
        List<String> descriptions = RULE_REGISTRY.describeRules();
        return String.join(";", descriptions);
    }
    
    /**
     * 清空所有规则
     */
    private static void clearRules() {
        RULE_REGISTRY.clear();
        AgentLogger.info("已清空所有拦截规则");
    }
    
    /**
     * 发送消息到 Node.js
     */
    private static void sendMessage(String type, String data) {
        if (out != null) {
            String json = "{\"type\":\"" + type + "\",\"data\":\"" + escapeJson(data) + "\"}";
            out.println(json);
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
     * 获取JVM信息
     */
    private static String getJVMInfo() {
        Runtime runtime = Runtime.getRuntime();
        StringBuilder sb = new StringBuilder();
        sb.append("Java: ").append(System.getProperty("java.version")).append(", ");
        sb.append("Memory: ").append(runtime.totalMemory() / 1024 / 1024).append("MB / ");
        sb.append(runtime.maxMemory() / 1024 / 1024).append("MB, ");
        sb.append("Processors: ").append(runtime.availableProcessors());
        return sb.toString();
    }
    
    /**
     * 简单的JSON值提取
     */
    private static String extractJsonValue(String json, String key) {
        String searchKey = "\"" + key + "\":\"";
        int start = json.indexOf(searchKey);
        if (start == -1) return "";
        start += searchKey.length();
        int end = json.indexOf("\"", start);
        if (end == -1) return "";
        return json.substring(start, end);
    }
    
    /**
     * JSON字符串转义
     */
    private static String escapeJson(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
    
    /**
     * 清理资源
     */
    private static void cleanup() {
        try {
            if (out != null) out.close();
            if (in != null) in.close();
            if (socket != null) socket.close();
            out = null;
            in = null;
            socket = null;
        } catch (Exception e) {
            // 忽略
        }
    }
}
