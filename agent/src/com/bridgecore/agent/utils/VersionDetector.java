package com.bridgecore.agent.utils;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.jar.JarFile;
import java.util.zip.ZipEntry;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class VersionDetector {
    
    /**
     * 尝试检测 Minecraft 版本
     */
    public static String detectVersion() {
        String classPath = System.getProperty("java.class.path");
        String[] paths = classPath.split(File.pathSeparator);
        
        for (String path : paths) {
            if (path.endsWith(".jar")) {
                try (JarFile jar = new JarFile(path)) {
                    // 1. 尝试读取 version.json (1.14+ 原版服务端包含此文件)
                    ZipEntry versionEntry = jar.getEntry("version.json");
                    if (versionEntry != null) {
                        String content = readEntry(jar, versionEntry);
                        // 查找 "id": "1.21"
                        String version = extractJsonValue(content, "id");
                        if (version != null) return version;
                        
                        // 查找 "name": "1.21"
                        version = extractJsonValue(content, "name");
                        if (version != null) return version;
                    }
                    
                    // 2. 尝试读取 META-INF/version.json (某些修改版)
                    versionEntry = jar.getEntry("META-INF/version.json");
                    if (versionEntry != null) {
                        String content = readEntry(jar, versionEntry);
                        String version = extractJsonValue(content, "id");
                        if (version != null) return version;
                    }

                } catch (Exception ignored) {
                    // 忽略无法读取的 jar
                }
            }
        }
        return null;
    }
    
    private static String readEntry(JarFile jar, ZipEntry entry) throws Exception {
        try (InputStream is = jar.getInputStream(entry);
             BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
            }
            return content.toString();
        }
    }
    
    private static String extractJsonValue(String json, String key) {
        // 简单的正则匹配: "key"\s*:\s*"([^"]+)"
        Pattern p = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]+)\"");
        Matcher m = p.matcher(json);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }
}

