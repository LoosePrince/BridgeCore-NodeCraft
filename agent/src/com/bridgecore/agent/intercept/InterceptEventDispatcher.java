package com.bridgecore.agent.intercept;

import java.util.Map;

/**
 * 拦截事件分发器
 */
@FunctionalInterface
public interface InterceptEventDispatcher {
    void onIntercept(String ruleId, String message, Map<String, String> playerInfo);
}

