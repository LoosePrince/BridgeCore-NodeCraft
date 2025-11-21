package com.bridgecore.agent.core;

import com.bridgecore.agent.config.AgentConfig;
import com.bridgecore.agent.logging.AgentLogger;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;

/**
 * 负责与 Node.js 侧通信的轻量客户端，提供消息队列与连接状态管理。
 */
public final class CommunicationClient {
    public interface MessageHandler {
        void onMessage(String rawMessage);
    }

    private final AgentConfig config;
    private final MessageHandler messageHandler;
    private final Object stateLock = new Object();
    private final List<String> pendingMessages = new ArrayList<>();

    private volatile boolean running;
    private volatile boolean connected;
    private Thread workerThread;
    private Socket socket;
    private PrintWriter out;
    private BufferedReader in;

    public CommunicationClient(AgentConfig config, MessageHandler handler) {
        this.config = config;
        this.messageHandler = handler;
    }

    public void start() {
        if (running) {
            return;
        }
        running = true;
        workerThread = new Thread(this::runLoop, "BCNC-Agent-Communication");
        workerThread.setDaemon(true);
        workerThread.start();
    }

    public void stop() {
        running = false;
        closeResources();
    }

    public boolean waitUntilReady(long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        synchronized (stateLock) {
            while (!connected) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) {
                    return false;
                }
                try {
                    stateLock.wait(Math.min(remaining, 500));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            return true;
        }
    }

    public void send(String jsonPayload) {
        synchronized (stateLock) {
            if (connected && out != null) {
                out.println(jsonPayload);
                return;
            }
        }
        synchronized (pendingMessages) {
            pendingMessages.add(jsonPayload);
        }
    }

    private void runLoop() {
        try {
            socket = new Socket(config.getHost(), config.getPort());
            out = new PrintWriter(socket.getOutputStream(), true);
            in = new BufferedReader(new InputStreamReader(socket.getInputStream()));

            synchronized (stateLock) {
                connected = true;
                stateLock.notifyAll();
            }

            AgentLogger.debug("通信客户端已连接 Node.js: " + config.getHost() + ":" + config.getPort());
            flushPendingMessages();

            String message;
            while (running && (message = in.readLine()) != null) {
                messageHandler.onMessage(message);
            }
        } catch (Exception e) {
            if (running) {
                AgentLogger.warn("通信客户端异常: " + e.getMessage());
            }
        } finally {
            closeResources();
            running = false;
        }
    }

    private void flushPendingMessages() {
        List<String> toSend;
        synchronized (pendingMessages) {
            if (pendingMessages.isEmpty()) {
                return;
            }
            toSend = new ArrayList<>(pendingMessages);
            pendingMessages.clear();
        }
        for (String message : toSend) {
            out.println(message);
        }
    }

    private void closeResources() {
        synchronized (stateLock) {
            connected = false;
        }
        try {
            if (out != null) {
                out.close();
            }
            if (in != null) {
                in.close();
            }
            if (socket != null && !socket.isClosed()) {
                socket.close();
            }
        } catch (IOException ignored) {
        }
        synchronized (stateLock) {
            stateLock.notifyAll();
        }
    }
}

