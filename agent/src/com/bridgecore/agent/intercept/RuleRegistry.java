package com.bridgecore.agent.intercept;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 拦截规则注册中心
 */
public class RuleRegistry {
    private final Map<String, InterceptRule> rules = new LinkedHashMap<>();

    public synchronized void register(InterceptRule rule) {
        rules.put(rule.getId(), rule);
    }

    public synchronized InterceptRule unregister(String ruleId) {
        return rules.remove(ruleId);
    }

    public synchronized void clear() {
        rules.clear();
    }

    public synchronized Collection<InterceptRule> getAll() {
        return new ArrayList<>(rules.values());
    }

    public synchronized InterceptRule findFirstMatch(String message) {
        for (InterceptRule rule : rules.values()) {
            if (rule.matches(message)) {
                return rule;
            }
        }
        return null;
    }

    public synchronized List<String> describeRules() {
        List<String> descriptions = new ArrayList<>();
        for (InterceptRule rule : rules.values()) {
            descriptions.add(rule.getId() + ":" + rule.getPattern() + ":" + rule.getMatchType().name().toLowerCase());
        }
        return descriptions;
    }

    public synchronized int size() {
        return rules.size();
    }
}

