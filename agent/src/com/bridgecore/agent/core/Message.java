package com.bridgecore.agent.core;

import com.bridgecore.agent.utils.JsonUtils;

/**
 * 消息 POJO 类 - 表示 Agent 与 Node.js 之间的消息
 */
public final class Message {
    private final MessageType type;
    private final String data;

    private Message(MessageType type, String data) {
        this.type = type;
        this.data = data != null ? data : "";
    }

    public static Message of(MessageType type, String data) {
        return new Message(type, data);
    }

    public static Message of(MessageType type) {
        return new Message(type, "");
    }

    /**
     * 从 JSON 字符串解析消息
     */
    public static Message fromJson(String json) {
        String typeStr = JsonUtils.extractValue(json, JsonUtils.KEY_TYPE);
        String data = JsonUtils.extractValue(json, JsonUtils.KEY_DATA);
        MessageType type = MessageType.fromString(typeStr);
        return new Message(type, data);
    }

    /**
     * 转换为 JSON 字符串
     */
    public String toJson() {
        return JsonUtils.buildMessage(type != null ? type.getValue() : "", data);
    }

    public MessageType getType() {
        return type;
    }

    public String getData() {
        return data;
    }

    public boolean hasType() {
        return type != null;
    }

    @Override
    public String toString() {
        return "Message{type=" + type + ", data='" + data + "'}";
    }
}

