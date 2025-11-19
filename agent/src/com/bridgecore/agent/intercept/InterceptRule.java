package com.bridgecore.agent.intercept;

/**
 * 拦截规则定义
 */
public class InterceptRule {
    private final String id;
    private final String pattern;
    private final MatchType matchType;
    private boolean enabled = true;

    public enum MatchType {
        PREFIX,
        CONTAINS,
        REGEX;

        public static MatchType fromString(String raw) {
            if (raw == null) {
                return PREFIX;
            }
            switch (raw.toLowerCase()) {
                case "contains":
                    return CONTAINS;
                case "regex":
                    return REGEX;
                default:
                    return PREFIX;
            }
        }
    }

    public InterceptRule(String id, String pattern, MatchType matchType) {
        this.id = id;
        this.pattern = pattern;
        this.matchType = matchType;
    }

    public String getId() {
        return id;
    }

    public String getPattern() {
        return pattern;
    }

    public MatchType getMatchType() {
        return matchType;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean matches(String message) {
        if (!enabled || message == null) {
            return false;
        }

        switch (matchType) {
            case CONTAINS:
                return message.contains(pattern);
            case REGEX:
                try {
                    return message.matches(pattern);
                } catch (Exception ignored) {
                    return false;
                }
            case PREFIX:
            default:
                return message.startsWith(pattern);
        }
    }
}

