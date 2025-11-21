package com.bridgecore.agent.utils;

/**
 * JSON 工具类 - 提供简单的 JSON 序列化和反序列化功能
 * 注意：这是一个轻量实现，仅用于简单的键值对场景
 */
public final class JsonUtils {
    // JSON 键名常量
    public static final String KEY_TYPE = "type";
    public static final String KEY_DATA = "data";
    public static final String KEY_STATUS = "status";
    public static final String KEY_VERSION = "version";
    public static final String KEY_PATH = "path";
    public static final String KEY_SOURCE = "source";
    public static final String KEY_ERROR = "error";
    public static final String KEY_SERVER_TYPE = "serverType";
    public static final String KEY_SERVER_TYPE_DISPLAY = "serverTypeDisplay";

    private JsonUtils() {}

    /**
     * 从 JSON 字符串中提取指定键的值
     * 
     * @param json JSON 字符串
     * @param key 要提取的键名
     * @return 键对应的值，如果不存在则返回空字符串
     */
    public static String extractValue(String json, String key) {
        if (json == null || key == null) {
            return "";
        }
        String searchKey = "\"" + key + "\":\"";
        int start = json.indexOf(searchKey);
        if (start == -1) {
            return "";
        }
        start += searchKey.length();
        int end = json.indexOf("\"", start);
        if (end == -1) {
            return "";
        }
        return json.substring(start, end);
    }

    /**
     * 转义 JSON 字符串中的特殊字符
     * 
     * @param str 原始字符串
     * @return 转义后的字符串
     */
    public static String escape(String str) {
        if (str == null) {
            return "";
        }
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }

    /**
     * 构建简单的 JSON 消息对象
     * 
     * @param type 消息类型
     * @param data 消息数据
     * @return JSON 字符串
     */
    public static String buildMessage(String type, String data) {
        return "{\"" + KEY_TYPE + "\":\"" + escape(type) + "\",\"" + KEY_DATA + "\":\"" + escape(data) + "\"}";
    }

    /**
     * 构建 JSON 对象（键值对形式）
     * 
     * @param pairs 键值对数组，格式：[key1, value1, key2, value2, ...]
     * @return JSON 字符串
     * @throws IllegalArgumentException 如果键值对数量不是偶数
     */
    public static String buildObject(String... pairs) {
        if (pairs == null || pairs.length == 0) {
            return "{}";
        }
        if (pairs.length % 2 != 0) {
            throw new IllegalArgumentException("键值对数量必须是偶数");
        }
        
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        for (int i = 0; i < pairs.length; i += 2) {
            if (i > 0) {
                sb.append(",");
            }
            String key = pairs[i];
            String value = pairs[i + 1];
            sb.append("\"").append(escape(key)).append("\":");
            if (value == null) {
                sb.append("null");
            } else {
                sb.append("\"").append(escape(value)).append("\"");
            }
        }
        sb.append("}");
        return sb.toString();
    }
}
