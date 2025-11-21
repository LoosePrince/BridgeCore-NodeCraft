package com.bridgecore.agent.exception;

/**
 * 注入异常 - 表示字节码注入过程中发生的错误
 */
public class InjectionException extends AgentException {
    public InjectionException(String message) {
        super(message);
    }

    public InjectionException(String message, Throwable cause) {
        super(message, cause);
    }
}

