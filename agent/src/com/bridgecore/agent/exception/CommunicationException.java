package com.bridgecore.agent.exception;

/**
 * 通信异常 - 表示与 Node.js 通信过程中发生的错误
 */
public class CommunicationException extends AgentException {
    public CommunicationException(String message) {
        super(message);
    }

    public CommunicationException(String message, Throwable cause) {
        super(message, cause);
    }
}

