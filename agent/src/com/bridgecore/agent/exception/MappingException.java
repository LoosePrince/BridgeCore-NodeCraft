package com.bridgecore.agent.exception;

/**
 * 映射异常 - 表示映射文件处理过程中发生的错误
 */
public class MappingException extends AgentException {
    public MappingException(String message) {
        super(message);
    }

    public MappingException(String message, Throwable cause) {
        super(message, cause);
    }
}

