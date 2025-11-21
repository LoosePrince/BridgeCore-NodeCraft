package com.bridgecore.agent.core;

/**
 * 消息类型枚举 - 定义所有 Agent 与 Node.js 之间的消息类型
 */
public enum MessageType {
    // 系统消息
    PING("PING"),
    PONG("PONG"),
    AGENT_READY("AGENT_READY"),
    SHUTDOWN("SHUTDOWN"),
    
    // 信息查询
    GET_INFO("GET_INFO"),
    GET_JVM_INFO("GET_JVM_INFO"),
    GET_CLASSES("GET_CLASSES"),
    JVM_INFO("JVM_INFO"),
    SERVER_INFO("SERVER_INFO"),
    SERVER_METADATA("SERVER_METADATA"),
    CLASSES_COUNT("CLASSES_COUNT"),
    
    // 规则管理
    REGISTER_RULE("REGISTER_RULE"),
    UNREGISTER_RULE("UNREGISTER_RULE"),
    LIST_RULES("LIST_RULES"),
    CLEAR_RULES("CLEAR_RULES"),
    RULE_REGISTERED("RULE_REGISTERED"),
    RULE_UNREGISTERED("RULE_UNREGISTERED"),
    RULE_NOT_FOUND("RULE_NOT_FOUND"),
    RULE_REGISTER_FAILED("RULE_REGISTER_FAILED"),
    RULES_LIST("RULES_LIST"),
    RULES_CLEARED("RULES_CLEARED"),
    
    // 拦截事件
    CHAT_INTERCEPTED("CHAT_INTERCEPTED"),
    PLAYER_LIST_UPDATED("PLAYER_LIST_UPDATED"),
    
    // 映射管理
    REQUEST_MAPPING("REQUEST_MAPPING"),
    MAPPING_READY("MAPPING_READY"),
    MAPPING_FAILED("MAPPING_FAILED"),
    
    // 日志管理
    SET_LOG_LEVEL("SET_LOG_LEVEL"),
    LOG_LEVEL_UPDATED("LOG_LEVEL_UPDATED");

    private final String value;

    MessageType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * 根据字符串值查找对应的枚举
     */
    public static MessageType fromString(String value) {
        if (value == null) {
            return null;
        }
        for (MessageType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        return null;
    }

    @Override
    public String toString() {
        return value;
    }
}

