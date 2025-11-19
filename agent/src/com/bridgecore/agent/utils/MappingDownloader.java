package com.bridgecore.agent.utils;

import com.bridgecore.agent.logging.AgentLogger;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MappingDownloader {
    private static final String MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest.json";

    /**
     * 下载指定版本的服务端映射表
     */
    public static boolean downloadMappings(String version, File outputFile) {
        try {
            AgentLogger.debug("正在获取版本清单...");
            String manifestJson = downloadString(MANIFEST_URL);

            String versionUrl = findVersionUrl(manifestJson, version);
            if (versionUrl == null) {
                AgentLogger.warn("未找到版本 " + version + " 的信息");
                return false;
            }

            AgentLogger.debug("正在获取版本信息...");
            String versionJson = downloadString(versionUrl);

            String mappingUrl = findMappingUrl(versionJson);
            if (mappingUrl == null) {
                AgentLogger.warn("未找到版本 " + version + " 的服务端映射表 (可能该版本未提供混淆映射)");
                return false;
            }

            AgentLogger.debug("正在下载映射表...");
            downloadFile(mappingUrl, outputFile);
            AgentLogger.info("映射表下载成功: " + outputFile.getAbsolutePath());
            return true;

        } catch (Exception e) {
            AgentLogger.warn("自动下载映射表失败: " + e.getMessage());
            return false;
        }
    }
    
    private static String downloadString(String urlStr) throws IOException {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
            }
            return content.toString();
        }
    }
    
    private static void downloadFile(String urlStr, File outputFile) throws IOException {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(10000);
        
        long contentLength = conn.getContentLengthLong();
        long startTime = System.currentTimeMillis();
        long lastLogTime = startTime;
        try (InputStream in = conn.getInputStream();
             FileOutputStream out = new FileOutputStream(outputFile)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            long totalBytes = 0;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
                totalBytes += bytesRead;
                
                long now = System.currentTimeMillis();
                long elapsed = now - startTime;
                if (elapsed > 10000) {
                    long interval = elapsed > 30000 ? 30000 : 10000;
                    if (now - lastLogTime >= interval) {
                        lastLogTime = now;
                        logProgress(totalBytes, contentLength, elapsed);
                    }
                }
            }
        }
    }
    
    private static String findVersionUrl(String json, String version) {
        // 查找: {"id": "1.21", ..., "url": "..."}
        // 注意: json 结构是 "versions": [ ... ]
        // 简化匹配: "id":"1.21".*?"url":"(http[^"]+)"
        // 需要处理跨行和顺序问题，但通常 id 在 url 之前
        
        // 更健壮的正则: 查找包含 id:version 的对象块，然后提取 url
        // 由于正则处理嵌套 JSON 很困难，我们假设标准格式
        
        // 策略: 查找 "id": "version" 后面的第一个 "url": "..."
        Pattern p = Pattern.compile("\"id\"\\s*:\\s*\"" + Pattern.quote(version) + "\".*?\"url\"\\s*:\\s*\"([^\"]+)\"", Pattern.DOTALL);
        Matcher m = p.matcher(json);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }
    
    private static String findMappingUrl(String json) {
        // 查找: "server_mappings": { ..., "url": "..." }
        // 简化: "server_mappings".*?"url":"(http[^"]+)"
        Pattern p = Pattern.compile("\"server_mappings\".*?\"url\"\\s*:\\s*\"([^\"]+)\"", Pattern.DOTALL);
        Matcher m = p.matcher(json);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }

    private static void logProgress(long downloadedBytes, long totalBytes, long elapsedMillis) {
        double elapsedSeconds = elapsedMillis / 1000.0;
        double bytesPerSecond = elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
        String speedStr = formatSpeed(bytesPerSecond);
        String percentStr = totalBytes > 0
            ? String.format("%d%%", Math.min(100, (int) ((downloadedBytes * 100) / totalBytes)))
            : "??%";
        String etaStr = totalBytes > 0 && bytesPerSecond > 0
            ? formatDuration((long) ((totalBytes - downloadedBytes) / bytesPerSecond))
            : "未知";
        AgentLogger.info(String.format("映射下载进度: %s %s 预计 %s", percentStr, speedStr, etaStr));
    }

    private static String formatSpeed(double bytesPerSecond) {
        if (bytesPerSecond <= 0) {
            return "0KB/s";
        }
        double kbPerSec = bytesPerSecond / 1024.0;
        if (kbPerSec < 1024) {
            return String.format("%.0fKB/s", kbPerSec);
        }
        double mbPerSec = kbPerSec / 1024.0;
        if (mbPerSec < 1024) {
            return String.format("%.1fMB/s", mbPerSec);
        }
        double gbPerSec = mbPerSec / 1024.0;
        return String.format("%.2fGB/s", gbPerSec);
    }

    private static String formatDuration(long seconds) {
        if (seconds <= 0) {
            return "立即完成";
        }
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;
        long secs = seconds % 60;
        if (hours > 0) {
            return minutes > 0 ? String.format("%d小时%d分钟", hours, minutes) : String.format("%d小时", hours);
        }
        if (minutes > 0) {
            return secs > 0 ? String.format("%d分钟%d秒", minutes, secs) : String.format("%d分钟", minutes);
        }
        return String.format("%d秒", secs);
    }
}

