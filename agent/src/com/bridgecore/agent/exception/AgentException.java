package com.bridgecore.agent.exception;

/**
 * Agent 基础异常类 - 所有 Agent 相关异常的基类
 */
public class AgentException extends Exception {
    public AgentException(String message) {
        super(message);
    }

    public AgentException(String message, Throwable cause) {
        super(message, cause);
    }
}

