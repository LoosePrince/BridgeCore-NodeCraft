package com.bridgecore.agent.core;

import com.bridgecore.agent.config.AgentConfig;
import com.bridgecore.agent.exception.MappingException;
import com.bridgecore.agent.injection.ServerType;
import com.bridgecore.agent.logging.AgentLogger;
import com.bridgecore.agent.utils.JsonUtils;
import com.bridgecore.agent.utils.VersionDetector;

import java.io.File;
import java.util.function.Consumer;

/**
 * 映射服务 - 负责管理映射文件的准备和状态通知
 */
public final class MappingService {
    private static final long MAPPING_REQUEST_TIMEOUT = 15000; // 15秒

    private final Object lock = new Object();
    private volatile boolean mappingReady = false;
    private volatile boolean mappingFailed = false;
    private volatile String mappingStatusMessage = "";

    private CommunicationClient communicationClient;
    private final Consumer<String> messageSender;

    public MappingService(Consumer<String> messageSender) {
        this.messageSender = messageSender;
    }

    public void setCommunicationClient(CommunicationClient communicationClient) {
        this.communicationClient = communicationClient;
    }

    /**
     * 准备映射文件
     * 
     * @throws MappingException 如果映射文件准备失败
     */
    public void prepareMappings(ServerType serverType, String detectedVersion, AgentConfig config) 
            throws MappingException {
        File mappingFile = config.getMappingFile();
        
        if (mappingFile.exists()) {
            AgentLogger.debug("检测到现有映射文件: " + mappingFile.getAbsolutePath());
            notifyReady(mappingFile, detectedVersion, "existing");
            return;
        }

        if (serverType != ServerType.VANILLA) {
            AgentLogger.debug("当前服务端类型为 " + serverType.getDisplayName() + "，无需自动下载映射表");
            return;
        }

        String version = detectedVersion != null ? detectedVersion : VersionDetector.detectVersion();
        if (version == null) {
            String errorMsg = "未能检测到 Minecraft 版本，无法请求映射表下载";
            AgentLogger.warn(errorMsg);
            AgentLogger.warn("请手动将 server.txt 放置在服务器根目录");
            throw new MappingException(errorMsg);
        }

        try {
            if (requestMappingsFromBCNC(version, mappingFile) && mappingFile.exists()) {
                AgentLogger.info("映射表已准备就绪: " + mappingFile.getAbsolutePath());
                notifyReady(mappingFile, version, "downloaded");
            } else if (!mappingFile.exists()) {
                String errorMsg = "BCNC 未能提供映射表，将尝试在无映射文件的情况下继续";
                AgentLogger.warn(errorMsg);
                notifyFailed(version, mappingFile.getAbsolutePath(), "download", mappingStatusMessage);
                // 不抛出异常，允许继续运行
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MappingException("映射请求被中断", e);
        }
    }

    /**
     * 处理映射就绪通知（来自 Node.js）
     */
    public void handleMappingReady(String data) {
        synchronized (lock) {
            mappingReady = true;
            mappingFailed = false;
            mappingStatusMessage = data;
            lock.notifyAll();
        }
    }

    /**
     * 处理映射失败通知（来自 Node.js）
     */
    public void handleMappingFailed(String data) {
        synchronized (lock) {
            mappingReady = false;
            mappingFailed = true;
            mappingStatusMessage = data;
            lock.notifyAll();
        }
    }

    private boolean requestMappingsFromBCNC(String version, File mappingFile) throws InterruptedException {
        if (communicationClient == null || !communicationClient.waitUntilReady(MAPPING_REQUEST_TIMEOUT)) {
            AgentLogger.warn("通信尚未就绪，无法请求 BCNC 下载映射表");
            return false;
        }

        synchronized (lock) {
            mappingReady = false;
            mappingFailed = false;
            mappingStatusMessage = "";
        }

        AgentLogger.info("请求 BCNC 下载映射表: 版本 " + version);
        String payload = JsonUtils.buildObject(
            JsonUtils.KEY_VERSION, version,
            JsonUtils.KEY_PATH, mappingFile.getAbsolutePath()
        );
        messageSender.accept(Message.of(MessageType.REQUEST_MAPPING, payload).toJson());

        synchronized (lock) {
            while (!mappingReady && !mappingFailed) {
                lock.wait();
            }

            if (mappingReady) {
                AgentLogger.debug("收到 BCNC 映射表完成通知: " + mappingStatusMessage);
                return true;
            }

            if (mappingFailed) {
                AgentLogger.warn("BCNC 下载映射表失败: " + mappingStatusMessage);
            }
            return false;
        }
    }

    private void notifyReady(File mappingFile, String version, String source) {
        try {
            String payload = JsonUtils.buildObject(
                JsonUtils.KEY_STATUS, "ready",
                JsonUtils.KEY_VERSION, version != null ? version : "",
                JsonUtils.KEY_PATH, mappingFile != null ? mappingFile.getAbsolutePath() : "",
                JsonUtils.KEY_SOURCE, source != null ? source : ""
            );
            messageSender.accept(Message.of(MessageType.MAPPING_READY, payload).toJson());
        } catch (Exception e) {
            AgentLogger.warn("通知 BCNC 映射状态失败: " + e.getMessage());
        }
    }

    private void notifyFailed(String version, String path, String source, String error) {
        try {
            String payload = JsonUtils.buildObject(
                JsonUtils.KEY_STATUS, "failed",
                JsonUtils.KEY_VERSION, version != null ? version : "",
                JsonUtils.KEY_PATH, path != null ? path : "",
                JsonUtils.KEY_SOURCE, source != null ? source : "",
                JsonUtils.KEY_ERROR, error != null ? error : ""
            );
            messageSender.accept(Message.of(MessageType.MAPPING_FAILED, payload).toJson());
        } catch (Exception e) {
            AgentLogger.warn("通知 BCNC 映射失败状态失败: " + e.getMessage());
        }
    }
}
