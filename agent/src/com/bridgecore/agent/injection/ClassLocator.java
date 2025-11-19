package com.bridgecore.agent.injection;

import java.lang.instrument.Instrumentation;
import java.util.ArrayList;
import java.util.List;

/**
 * 类定位器 - 负责查找目标类
 */
public class ClassLocator {
    private final Instrumentation instrumentation;
    private final InjectionConfig config;

    public ClassLocator(Instrumentation instrumentation, InjectionConfig config) {
        this.instrumentation = instrumentation;
        this.config = config;
    }

    /**
     * 查找所有匹配的目标类
     */
    public List<Class<?>> locateTargetClasses() {
        List<Class<?>> foundClasses = new ArrayList<>();
        List<String> targetNames = config.getTargetClassNames();
        
        Class<?>[] allClasses = instrumentation.getAllLoadedClasses();
        
        for (Class<?> clazz : allClasses) {
            String className = clazz.getName();
            String internalName = className.replace('.', '/');
            
            for (String targetName : targetNames) {
                String targetInternal = targetName.replace('.', '/');
                
                // 精确匹配
                if (className.equals(targetName) || internalName.equals(targetInternal)) {
                    foundClasses.add(clazz);
                    break;
                }
                
                // 模糊匹配（包含）
                if (targetName.contains("*")) {
                    String pattern = targetName.replace("*", ".*").replace(".", "\\.");
                    if (className.matches(pattern)) {
                        foundClasses.add(clazz);
                        break;
                    }
                }
            }
        }
        
        return foundClasses;
    }

    /**
     * 查找第一个可修改的目标类
     */
    public Class<?> locateFirstModifiableClass() {
        List<Class<?>> classes = locateTargetClasses();
        
        for (Class<?> clazz : classes) {
            if (instrumentation.isModifiableClass(clazz)) {
                return clazz;
            }
        }
        
        return null;
    }

    /**
     * 检查类是否可修改
     */
    public boolean isModifiable(Class<?> clazz) {
        return instrumentation.isModifiableClass(clazz);
    }

}

