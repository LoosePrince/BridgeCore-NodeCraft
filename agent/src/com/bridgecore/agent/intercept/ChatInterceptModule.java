package com.bridgecore.agent.intercept;

import com.bridgecore.agent.logging.AgentLogger;
import java.util.Map;
import java.util.Objects;

/**
 * 聊天拦截模块
 */
public final class ChatInterceptModule {
    private static final RuleRegistry RULES = new RuleRegistry();
    private static PlayerInfoExtractor playerInfoExtractor;
    private static InterceptEventDispatcher dispatcher;

    private ChatInterceptModule() {}

    public static void initialize(InterceptEventDispatcher eventDispatcher) {
        dispatcher = Objects.requireNonNull(eventDispatcher, "eventDispatcher");
        // 延迟初始化，确保在需要时创建
        if (playerInfoExtractor == null) {
            playerInfoExtractor = new PlayerInfoExtractor();
        }
    }

    public static void setPlayerInfoExtractor(PlayerInfoExtractor extractor) {
        playerInfoExtractor = extractor;
    }

    public static RuleRegistry getRuleRegistry() {
        return RULES;
    }

    public static boolean handleChat(String message, Object handler) {
        // 调试日志
        // System.out.println("[BCNC Agent] handleChat called: " + message);

        if (message == null || dispatcher == null) {
            return false;
        }

        InterceptRule rule = RULES.findFirstMatch(message);
        if (rule == null) {
            return false;
        }
        
        AgentLogger.debug("[ChatIntercept] 拦截到匹配消息: " + message + " (规则: " + rule.getId() + ")");

        Map<String, String> playerInfo = playerInfoExtractor.extract(handler);
        dispatcher.onIntercept(rule.getId(), message, playerInfo);
        return true;
    }
}

