package com.bridgecore.agent.injection;

import com.bridgecore.agent.logging.AgentLogger;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * 混淆映射解析器
 * 支持解析 ProGuard 格式的映射文件 (server.txt)
 */
public class MappingResolver {
    private final Map<String, String> classMap = new HashMap<>();
    private final Map<String, String> methodMap = new HashMap<>();

    /**
     * 加载映射文件
     */
    public void loadMapping(File mappingFile) {
        if (!mappingFile.exists()) {
            AgentLogger.warn("映射文件不存在: " + mappingFile.getAbsolutePath());
            return;
        }

        AgentLogger.debug("正在加载映射文件: " + mappingFile.getAbsolutePath());
        try (BufferedReader reader = new BufferedReader(new FileReader(mappingFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }

                // 解析类映射: com.example.MyClass -> a:
                if (line.endsWith(":")) {
                    parseClassMapping(line);
                } 
                // 解析方法映射 (暂未实现详细解析，目前主要关注类名)
            }
            AgentLogger.debug("已加载 " + classMap.size() + " 个类映射");
        } catch (IOException e) {
            AgentLogger.error("加载映射文件失败: " + e.getMessage(), e);
        }
    }

    private void parseClassMapping(String line) {
        // 格式: original.package.ClassName -> obfuscatedName:
        String content = line.substring(0, line.length() - 1); // 去掉冒号
        String[] parts = content.split(" -> ");
        if (parts.length == 2) {
            String originalName = parts[0];
            String obfuscatedName = parts[1];
            classMap.put(originalName, obfuscatedName);
            
            if (originalName.endsWith("ServerPlayNetworkHandler") ||
                originalName.endsWith("ServerPlayer") ||
                originalName.endsWith("ServerGamePacketListenerImpl")) {
                AgentLogger.debug("映射解析: " + originalName + " -> " + obfuscatedName);
            }
        }
    }

    /**
     * 获取混淆后的类名
     * @param originalName 原始类名 (如 net.minecraft.server.network.ServerPlayNetworkHandler)
     * @return 混淆后的类名 (如 a)，如果未找到则返回 null
     */
    public String getObfuscatedClassName(String originalName) {
        String result = classMap.get(originalName);
        if (result == null && (originalName.contains("ServerPlayer") || originalName.contains("ServerGamePacketListenerImpl"))) {
            AgentLogger.debug("未找到映射: " + originalName + " (映射表大小: " + classMap.size() + ")");
            // 尝试查找部分匹配
            for (String key : classMap.keySet()) {
                if (key.contains("ServerPlayer") || key.contains("ServerGamePacketListenerImpl")) {
                    AgentLogger.debug("找到相关映射: " + key + " -> " + classMap.get(key));
                }
            }
        }
        return result;
    }
}

