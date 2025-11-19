package com.bridgecore.agent.logging;

import java.io.PrintStream;
import java.util.Locale;
import java.util.Objects;

/**
 * 简单日志工具，支持根据 BCNC 的日志级别控制输出
 */
public final class AgentLogger {

    public enum LogLevel {
        TRACE,
        DEBUG,
        INFO,
        WARN,
        ERROR;

        public static LogLevel fromString(String value) {
            if (value == null) {
                return null;
            }
            String normalized = value.trim().toUpperCase(Locale.ROOT);
            for (LogLevel level : values()) {
                if (level.name().equals(normalized)) {
                    return level;
                }
            }
            return null;
        }
    }

    private static volatile LogLevel currentLevel = LogLevel.INFO;

    private AgentLogger() {}

    static {
        initializeFromSystem();
    }

    public static void initializeFromSystem() {
        String level = System.getProperty("bcnc.log.level");
        if (level == null || level.isEmpty()) {
            level = System.getProperty("bcnc.agent.logLevel");
        }
        if (level == null || level.isEmpty()) {
            level = System.getenv("BCNC_LOG_LEVEL");
        }
        if (level == null || level.isEmpty()) {
            level = System.getenv("BCNC_AGENT_LOG_LEVEL");
        }
        if (level != null && !level.isEmpty()) {
            setLevel(level, true);
        }
    }

    public static LogLevel getLevel() {
        return currentLevel;
    }

    public static void setLevel(String levelName) {
        setLevel(levelName, false);
    }

    private static void setLevel(String levelName, boolean silent) {
        LogLevel level = LogLevel.fromString(levelName);
        if (level != null) {
            currentLevel = level;
            if (!silent) {
                debug("日志级别已切换为: " + level.name());
            }
        } else if (!silent) {
            warn("无法识别的日志级别: " + levelName);
        }
    }

    public static void setLevel(LogLevel level) {
        if (level != null) {
            currentLevel = level;
            debug("日志级别已切换为: " + level.name());
        }
    }

    public static boolean isEnabled(LogLevel level) {
        return level.ordinal() >= currentLevel.ordinal();
    }

    public static void trace(String message) {
        log(LogLevel.TRACE, message, null);
    }

    public static void debug(String message) {
        log(LogLevel.DEBUG, message, null);
    }

    public static void info(String message) {
        log(LogLevel.INFO, message, null);
    }

    public static void warn(String message) {
        log(LogLevel.WARN, message, null);
    }

    public static void error(String message) {
        log(LogLevel.ERROR, message, null);
    }

    public static void error(String message, Throwable throwable) {
        log(LogLevel.ERROR, message, throwable);
    }

    private static void log(LogLevel level, String message, Throwable throwable) {
        Objects.requireNonNull(level, "level");
        if (!isEnabled(level)) {
            return;
        }
        PrintStream stream = level.ordinal() >= LogLevel.WARN.ordinal() ? System.err : System.out;
        stream.println("[BCNC Agent][" + level.name() + "] " + message);
        if (throwable != null) {
            throwable.printStackTrace(stream);
        }
    }
}

