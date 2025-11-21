package com.bridgecore.agent.core;

import com.bridgecore.agent.intercept.InterceptRule;
import com.bridgecore.agent.intercept.RuleRegistry;
import com.bridgecore.agent.logging.AgentLogger;

import java.lang.instrument.Instrumentation;
import java.util.function.Consumer;

/**
 * 消息路由器 - 负责处理来自 Node.js 的消息并路由到相应的处理器
 */
public final class MessageRouter {
    private final RuleRegistry ruleRegistry;
    private final Instrumentation instrumentation;
    private final Consumer<String> messageSender;
    private final Runnable shutdownHandler;

    public MessageRouter(RuleRegistry ruleRegistry, Instrumentation instrumentation,
                        Consumer<String> messageSender, Runnable shutdownHandler) {
        this.ruleRegistry = ruleRegistry;
        this.instrumentation = instrumentation;
        this.messageSender = messageSender;
        this.shutdownHandler = shutdownHandler;
    }

    /**
     * 处理来自 Node.js 的原始消息
     */
    public void handle(String rawMessage) {
        try {
            Message message = Message.fromJson(rawMessage);
            
            if (!message.hasType()) {
                AgentLogger.debug("收到未知消息类型: " + rawMessage);
                return;
            }

            switch (message.getType()) {
                case PING:
                    sendMessage(MessageType.PONG, "Agent is alive");
                    AgentLogger.debug("收到 Ping 消息");
                    break;

                case GET_INFO:
                case GET_JVM_INFO:
                    sendMessage(MessageType.JVM_INFO, getJVMInfo());
                    break;

                case GET_CLASSES:
                    String count = instrumentation != null
                        ? String.valueOf(instrumentation.getAllLoadedClasses().length)
                        : "N/A";
                    sendMessage(MessageType.CLASSES_COUNT, count);
                    break;

                case REGISTER_RULE:
                    registerRule(message.getData());
                    break;

                case UNREGISTER_RULE:
                    unregisterRule(message.getData());
                    break;

                case LIST_RULES:
                    String rulesList = listRules();
                    sendMessage(MessageType.RULES_LIST, rulesList);
                    break;

                case CLEAR_RULES:
                    clearRules();
                    sendMessage(MessageType.RULES_CLEARED, "All rules cleared");
                    break;

                case SHUTDOWN:
                    AgentLogger.info("收到关闭命令");
                    shutdownHandler.run();
                    break;

                case SET_LOG_LEVEL:
                    AgentLogger.setLevel(message.getData());
                    sendMessage(MessageType.LOG_LEVEL_UPDATED, message.getData());
                    break;

                default:
                    AgentLogger.debug("未处理的消息类型: " + message.getType());
            }
        } catch (Exception e) {
            AgentLogger.error("处理消息时发生错误: " + e.getMessage(), e);
        }
    }

    private void registerRule(String data) {
        try {
            String[] parts = data.split("\\|", 3);
            if (parts.length < 3) {
                sendMessage(MessageType.RULE_REGISTER_FAILED, "Invalid rule format: " + data);
                return;
            }

            String id = parts[0];
            String pattern = parts[1];
            InterceptRule.MatchType type = InterceptRule.MatchType.fromString(parts[2]);

            if (type == null) {
                sendMessage(MessageType.RULE_REGISTER_FAILED, "Invalid match type: " + parts[2]);
                return;
            }

            InterceptRule rule = new InterceptRule(id, pattern, type);
            ruleRegistry.register(rule);

            AgentLogger.debug("注册规则: " + id + " (" + type.name().toLowerCase() + ": " + pattern + ")");
            sendMessage(MessageType.RULE_REGISTERED, id);
        } catch (Exception e) {
            AgentLogger.warn("注册规则失败: " + e.getMessage());
            sendMessage(MessageType.RULE_REGISTER_FAILED, e.getMessage());
        }
    }

    private void unregisterRule(String ruleId) {
        if (ruleRegistry.unregister(ruleId) != null) {
            AgentLogger.debug("注销规则: " + ruleId);
            sendMessage(MessageType.RULE_UNREGISTERED, ruleId);
        } else {
            sendMessage(MessageType.RULE_NOT_FOUND, ruleId);
        }
    }

    private String listRules() {
        return String.join(";", ruleRegistry.describeRules());
    }

    private void clearRules() {
        ruleRegistry.clear();
        AgentLogger.info("已清空所有拦截规则");
    }

    private String getJVMInfo() {
        Runtime runtime = Runtime.getRuntime();
        StringBuilder sb = new StringBuilder();
        sb.append("Java: ").append(System.getProperty("java.version")).append(", ");
        sb.append("Memory: ").append(runtime.totalMemory() / 1024 / 1024).append("MB / ");
        sb.append(runtime.maxMemory() / 1024 / 1024).append("MB, ");
        sb.append("Processors: ").append(runtime.availableProcessors());
        return sb.toString();
    }

    private void sendMessage(MessageType type, String data) {
        messageSender.accept(Message.of(type, data).toJson());
    }
}
