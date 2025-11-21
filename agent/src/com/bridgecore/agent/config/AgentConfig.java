package com.bridgecore.agent.config;

import java.io.File;

/**
 * Agent 配置集中管理通信与映射设置
 */
public final class AgentConfig {
    public static final String DEFAULT_HOST = "127.0.0.1";
    public static final int DEFAULT_PORT = 25575;
    public static final String DEFAULT_MAPPING_FILENAME = "server.txt";

    private final String host;
    private final int port;
    private final File mappingFile;

    private AgentConfig(String host, int port, File mappingFile) {
        this.host = host;
        this.port = port;
        this.mappingFile = mappingFile;
    }

    public static AgentConfig fromArgs(String args) {
        String host = DEFAULT_HOST;
        int port = DEFAULT_PORT;
        String mappingPath = DEFAULT_MAPPING_FILENAME;

        if (args != null) {
            String parsedHost = extractValue(args, "host");
            String parsedPort = extractValue(args, "port");
            String parsedMapping = extractValue(args, "mapping");

            if (parsedHost != null && !parsedHost.isEmpty()) {
                host = parsedHost;
            }
            if (parsedPort != null) {
                try {
                    port = Integer.parseInt(parsedPort);
                } catch (NumberFormatException ignored) {
                    // 维持默认值，由上层记录日志
                }
            }
            if (parsedMapping != null && !parsedMapping.isEmpty()) {
                mappingPath = parsedMapping;
            }
        }

        return new AgentConfig(host, port, new File(mappingPath));
    }

    private static String extractValue(String source, String key) {
        String pattern = key + "=";
        int start = source.indexOf(pattern);
        if (start == -1) {
            return null;
        }
        start += pattern.length();
        int end = source.indexOf(' ', start);
        if (end == -1) {
            end = source.length();
        }
        return source.substring(start, end).trim();
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public File getMappingFile() {
        return mappingFile;
    }
}

