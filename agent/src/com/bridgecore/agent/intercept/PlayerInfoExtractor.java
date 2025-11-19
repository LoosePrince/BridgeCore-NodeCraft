package com.bridgecore.agent.intercept;

import com.bridgecore.agent.injection.MappingResolver;
import com.bridgecore.agent.logging.AgentLogger;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

/**
 * 玩家信息提取器
 */
public class PlayerInfoExtractor {
    private final MappingResolver mappingResolver;

    public PlayerInfoExtractor() {
        this(null);
    }

    public PlayerInfoExtractor(MappingResolver mappingResolver) {
        this.mappingResolver = mappingResolver;
    }

    public Map<String, String> extract(Object handler) {
        Map<String, String> info = new HashMap<>();
        info.put("playerName", "Unknown");
        info.put("playerUuid", "Unknown");
        info.put("handlerClass", handler != null ? handler.getClass().getName() : "null");

        if (handler == null) {
            return info;
        }

        PlayerIdentity identity = extractPlayerIdentity(handler);
        if (identity != null) {
            if (identity.name != null && !identity.name.isEmpty()) {
                info.put("playerName", identity.name);
            }
            if (identity.uuid != null && !identity.uuid.isEmpty()) {
                info.put("playerUuid", identity.uuid);
            }
        }
        return info;
    }

    private PlayerIdentity extractPlayerIdentity(Object handler) {
        PlayerIdentity identity = new PlayerIdentity();

        // handler 是 ServerGamePacketListenerImpl
        AgentLogger.debug("[PlayerExtractor] 开始提取玩家名称，handler类: " + handler.getClass().getName());
        
        // 方法0: 直接调用 ServerGamePacketListenerImpl 的 i() 方法获取 GameProfile
        // 从日志看，i()Lcom/mojang/authlib/GameProfile; 方法存在
        try {
            // 尝试调用所有返回 GameProfile 的方法（无参数）
            for (Method method : handler.getClass().getDeclaredMethods()) {
                method.setAccessible(true);
                if (method.getParameterCount() == 0) {
                    Class<?> returnType = method.getReturnType();
                    String returnTypeName = returnType.getName();
                    if (returnTypeName.contains("GameProfile") || returnTypeName.contains("com.mojang.authlib")) {
                AgentLogger.debug("[PlayerExtractor] 尝试调用方法: " + method.getName() + " 返回类型: " + returnTypeName);
                        Object profile = method.invoke(handler);
                        PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
                        if (profileIdentity.hasData()) {
                            return profileIdentity;
                        }
                    }
                }
            }
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 调用 GameProfile 方法时出错: " + e.getMessage());
        }
        
        // 通过映射表动态查找 ServerPlayer 的混淆类名
        String serverPlayerObfuscated = mappingResolver != null ? 
            mappingResolver.getObfuscatedClassName("net.minecraft.server.level.ServerPlayer") : null;
        AgentLogger.debug("[PlayerExtractor] ServerPlayer混淆名: " + serverPlayerObfuscated);
        
        // 方法1: 尝试调用所有返回 ServerPlayer 的无参方法
        try {
            for (Method method : getAllMethods(handler.getClass())) {
                method.setAccessible(true);
                if (method.getParameterCount() == 0) {
                    Class<?> returnType = method.getReturnType();
                    if (returnType != null) {
                        String returnTypeName = returnType.getName();
                        if (isServerPlayer(returnTypeName, serverPlayerObfuscated)) {
                            AgentLogger.debug("[PlayerExtractor] 调用返回 ServerPlayer 的方法: " + method.getName());
                            Object playerObj = method.invoke(handler);
                            PlayerIdentity methodIdentity = extractIdentityFromPlayer(playerObj);
                            if (methodIdentity.hasData()) {
                                AgentLogger.debug("[PlayerExtractor] 通过方法 " + method.getName() + " 成功提取玩家: " + methodIdentity);
                                return methodIdentity;
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 调用返回 ServerPlayer 方法时出错: " + e.getMessage());
        }
        
        // 方法2: 遍历字段查找 ServerPlayer（通过类型匹配，不依赖硬编码的字段名）
        try {
            int fieldCount = 0;
            for (Field field : getAllFields(handler.getClass())) {
                field.setAccessible(true);
                Object fieldValue = field.get(handler);
                if (fieldValue == null) continue;
                
                fieldCount++;
                String fieldClassName = fieldValue.getClass().getName();
                AgentLogger.debug("[PlayerExtractor] 字段 " + field.getName() + " 类型: " + fieldClassName);
                
                boolean fieldLooksLikePlayer = field.getName().equalsIgnoreCase("player") ||
                    field.getName().toLowerCase().contains("player");
                
                // 检查是否是 ServerPlayer（通过映射表动态查找混淆名）
                if (fieldLooksLikePlayer || isServerPlayer(fieldClassName, serverPlayerObfuscated)) {
                    AgentLogger.debug("[PlayerExtractor] 找到 ServerPlayer 字段: " + field.getName());
                    PlayerIdentity playerIdentity = extractIdentityFromPlayer(fieldValue);
                    if (playerIdentity.hasData()) {
                        AgentLogger.debug("[PlayerExtractor] 成功提取玩家身份: " + playerIdentity);
                        return playerIdentity;
                    }
                    AgentLogger.debug("[PlayerExtractor] 未能从 ServerPlayer 对象中提取名称");
                }
            }
            AgentLogger.debug("[PlayerExtractor] 遍历了 " + fieldCount + " 个非空字段，未找到 ServerPlayer");
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 遍历字段时出错: " + e.getMessage());
        }

        // 方法3: 尝试常见的方法名（未混淆的情况，用于 Fabric 等）
        try {
            Method getProfileMethod = handler.getClass().getMethod("getGameProfileForPacketTweaker");
            Object profile = getProfileMethod.invoke(handler);
            PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
            if (profileIdentity.hasData()) {
                return profileIdentity;
            }
        } catch (Exception ignored) {}

        try {
            Method getPlayerMethod = handler.getClass().getMethod("getPlayerForPacketTweaker");
            Object playerEntity = getPlayerMethod.invoke(handler);
            PlayerIdentity playerIdentity = extractIdentityFromPlayer(playerEntity);
            if (playerIdentity.hasData()) {
                return playerIdentity;
            }
        } catch (Exception ignored) {}

        return identity.hasData() ? identity : null;
    }
    
    /**
     * 从 ServerPlayer 对象中提取玩家身份
     */
    private PlayerIdentity extractIdentityFromPlayer(Object player) {
        PlayerIdentity identity = new PlayerIdentity();
        if (player == null) return identity;

        AgentLogger.debug("[PlayerExtractor] 从 ServerPlayer 对象提取名称，类: " + player.getClass().getName());
        
        // 方法1: 遍历字段查找 GameProfile
        try {
            int fieldCount = 0;
            for (Field field : getAllFields(player.getClass())) {
                field.setAccessible(true);
                Object fieldValue = field.get(player);
                if (fieldValue == null) continue;
                
                fieldCount++;
                // 检查是否是 GameProfile
                Class<?> fieldClass = fieldValue.getClass();
                String fieldClassName = fieldClass.getName();
                AgentLogger.debug("[PlayerExtractor] ServerPlayer字段 " + field.getName() + " 类型: " + fieldClassName);
                
                if (fieldClassName.contains("GameProfile") || fieldClassName.contains("com.mojang.authlib")) {
                    AgentLogger.debug("[PlayerExtractor] 找到 GameProfile 字段: " + field.getName());
                    PlayerIdentity profileIdentity = extractIdentityFromProfile(fieldValue);
                    identity.merge(profileIdentity);
                }

                // 直接检查 String/UUID 字段
                updateIdentityFromPrimitiveField(identity, fieldValue);
            }
            AgentLogger.debug("[PlayerExtractor] 遍历了 " + fieldCount + " 个非空字段，未找到 GameProfile");
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 遍历 ServerPlayer 字段时出错: " + e.getMessage());
        }
        
        // 方法2: 尝试调用所有返回 GameProfile 的方法
        try {
            int methodCount = 0;
            for (Method method : getAllMethods(player.getClass())) {
                method.setAccessible(true);
                Class<?> returnType = method.getParameterCount() == 0 ? method.getReturnType() : null;
                if (returnType != null && (returnType.getName().contains("GameProfile") || 
                    returnType.getName().contains("com.mojang.authlib"))) {
                    methodCount++;
                    AgentLogger.debug("[PlayerExtractor] 尝试方法: " + method.getName() + " 返回类型: " + returnType.getName());
                    try {
                        Object profile = method.invoke(player);
                        PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
                        identity.merge(profileIdentity);
                        if (identity.hasData()) {
                            return identity;
                        }
                    } catch (Exception e) {
                        AgentLogger.debug("[PlayerExtractor] 调用方法 " + method.getName() + " 失败: " + e.getMessage());
                    }
                }
            }
            AgentLogger.debug("[PlayerExtractor] 尝试了 " + methodCount + " 个返回 GameProfile 的方法");
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 遍历方法时出错: " + e.getMessage());
        }
        
        // 方法3: 直接尝试 getName() / getId() 方法
        try {
            Method getName = player.getClass().getMethod("getName");
            Object nameObj = getName.invoke(player);
            if (nameObj != null) {
                AgentLogger.debug("[PlayerExtractor] 通过 getName() 获取名称: " + nameObj);
                identity.name = nameObj.toString();
            }
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 直接调用 getName() 失败: " + e.getMessage());
        }
        
        try {
            Method getId = player.getClass().getMethod("getUUID");
            Object uuidObj = getId.invoke(player);
            if (uuidObj != null) {
                identity.uuid = uuidObj.toString();
            }
        } catch (Exception ignored) {}

        if (identity.uuid == null) {
            try {
                Method getUniqueId = player.getClass().getMethod("getUniqueID");
                Object uuidObj = getUniqueId.invoke(player);
                if (uuidObj != null) {
                    identity.uuid = uuidObj.toString();
                }
            } catch (Exception ignored) {}
        }

        if (!identity.hasData()) {
            AgentLogger.debug("[PlayerExtractor] 所有方法都失败，返回 null");
        }
        return identity;
    }

    private PlayerIdentity extractIdentityFromProfile(Object profile) {
        PlayerIdentity identity = new PlayerIdentity();
        if (profile == null) {
            return identity;
        }

        Class<?> profileClass = profile.getClass();
        AgentLogger.debug("[PlayerExtractor] 处理 GameProfile 对象: " + profileClass.getName());

        // 尝试常见的方法
        identity.name = invokeStringMethod(profile, "getName", "name", "c", "d");
        if (identity.uuid == null) {
            Object uuidObj = invokeMethod(profile, "getId", "getUUID", "id");
            if (uuidObj != null) {
                identity.uuid = uuidObj.toString();
            }
        }

        // 尝试无参方法，返回 String/UUID
        if (!identity.hasData()) {
            for (Method method : profileClass.getDeclaredMethods()) {
                try {
                    if (method.getParameterCount() == 0) {
                        Class<?> returnType = method.getReturnType();
                        method.setAccessible(true);
                        if (returnType == String.class) {
                            Object value = method.invoke(profile);
                            updateIdentityFromString(identity, method.getName(), (String) value);
                        } else if (returnType.getName().equals("java.util.UUID")) {
                            Object value = method.invoke(profile);
                            if (value != null) {
                                identity.uuid = value.toString();
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
        }

        // 尝试字段
        if (!identity.hasData()) {
            for (Field field : profileClass.getDeclaredFields()) {
                try {
                    field.setAccessible(true);
                    Object value = field.get(profile);
                    updateIdentityFromPrimitiveField(identity, value);
                } catch (Exception ignored) {}
            }
        }

        return identity;
    }

    private void updateIdentityFromPrimitiveField(PlayerIdentity identity, Object value) {
        if (value == null) {
            return;
        }

        if (value instanceof String) {
            updateIdentityFromString(identity, null, (String) value);
        } else if (value instanceof java.util.UUID) {
            identity.uuid = value.toString();
        }
    }

    private void updateIdentityFromString(PlayerIdentity identity, String source, String value) {
        if (value == null) {
            return;
        }
        if (isValidPlayerName(value) && identity.name == null) {
            AgentLogger.debug("[PlayerExtractor] 识别到可能的玩家名 (来源: " + source + "): " + value);
            identity.name = value;
        } else if (isValidUuid(value) && identity.uuid == null) {
            AgentLogger.debug("[PlayerExtractor] 识别到可能的玩家 UUID (来源: " + source + "): " + value);
            identity.uuid = value.toLowerCase();
        }
    }

    private boolean isValidPlayerName(String value) {
        return value.length() >= 3 && value.length() <= 32 && value.matches("[A-Za-z0-9_]+");
    }

    private boolean isValidUuid(String value) {
        return value.length() >= 32 && value.length() <= 36 && value.replace("-", "").matches("[0-9a-fA-F]+");
    }

    private Object invokeMethod(Object target, String... methodNames) {
        for (String name : methodNames) {
            try {
                Method method = target.getClass().getMethod(name);
                method.setAccessible(true);
                return method.invoke(target);
            } catch (Exception ignored) {}
        }
        return null;
    }

    private String invokeStringMethod(Object target, String... methodNames) {
        Object result = invokeMethod(target, methodNames);
        return result instanceof String ? (String) result : null;
    }

    private static final class PlayerIdentity {
        String name;
        String uuid;

        boolean hasData() {
            return (name != null && !name.isEmpty()) || (uuid != null && !uuid.isEmpty());
        }

        void merge(PlayerIdentity other) {
            if (other == null) {
                return;
            }
            if (this.name == null || this.name.equals("Unknown")) {
                this.name = other.name;
            }
            if (this.uuid == null || this.uuid.equals("Unknown")) {
                this.uuid = other.uuid;
            }
        }

        @Override
        public String toString() {
            return "PlayerIdentity{name='" + name + "', uuid='" + uuid + "'}";
        }
    }
    
    /**
     * 检查是否是 ServerPlayer 类型（通过映射表动态查找混淆名）
     */
    private boolean isServerPlayer(String className, String obfuscatedName) {
        // 检查未混淆的类名
        if (className == null) {
            return false;
        }
        if (className.contains("ServerPlayer") ||
            className.contains("ServerPlayerEntity") ||
            className.contains("EntityPlayer") ||
            className.contains("PlayerEntity") ||
            className.contains("class_3222")) {
            return true;
        }
        // 通过映射表查找的混淆名
        if (obfuscatedName != null && className.equals(obfuscatedName)) {
            return true;
        }
        // 如果映射解析器可用，也检查多个旧版本类名
        if (mappingResolver != null) {
            String[] candidates = new String[] {
                "net.minecraft.server.level.ServerPlayer",
                "net.minecraft.server.level.EntityPlayer",
                "net.minecraft.server.network.ServerPlayerEntity",
                "net.minecraft.server.players.ServerPlayer",
                "net.minecraft.server.level.ServerPlayerEntity",
                "net.minecraft.server.level.EntityPlayerEntity"
            };
            for (String candidate : candidates) {
                String mapped = mappingResolver.getObfuscatedClassName(candidate);
                if (mapped != null && className.equals(mapped)) {
                    return true;
                }
            }
        }
        // 如果映射解析器没有找到混淆名，但类名是常见混淆名，也接受
        if (className.equals("awy") || className.equals("aah") || className.equals("bvf")) {
            AgentLogger.debug("[PlayerExtractor] 通过已知混淆名识别 ServerPlayer: " + className);
            return true;
        }
        return false;
    }

    private boolean isPlayerEntity(String className) {
        // 也检查 ServerPlayer（新版本使用 ServerPlayer 而不是 ServerPlayerEntity）
        if (isServerPlayer(className, null)) {
            return true;
        }
        if (className.contains("ServerPlayerEntity") || className.contains("class_3222")) {
            return true;
        }
        // 如果有映射表，检查是否匹配 ServerPlayerEntity 的混淆名
        if (mappingResolver != null) {
            String obfuscated = mappingResolver.getObfuscatedClassName("net.minecraft.server.network.ServerPlayerEntity");
            if (obfuscated != null && className.equals(obfuscated)) {
                return true;
            }
            // 也可以检查父类 PlayerEntity
            obfuscated = mappingResolver.getObfuscatedClassName("net.minecraft.entity.player.PlayerEntity");
            if (obfuscated != null && className.equals(obfuscated)) {
                return true;
            }
        }
        return false;
    }

    private Field[] getAllFields(Class<?> type) {
        java.util.List<Field> fields = new java.util.ArrayList<>();
        Class<?> current = type;
        while (current != null && current != Object.class) {
            for (Field field : current.getDeclaredFields()) {
                fields.add(field);
            }
            current = current.getSuperclass();
        }
        return fields.toArray(new Field[0]);
    }

    private Method[] getAllMethods(Class<?> type) {
        java.util.List<Method> methods = new java.util.ArrayList<>();
        Class<?> current = type;
        while (current != null && current != Object.class) {
            for (Method method : current.getDeclaredMethods()) {
                methods.add(method);
            }
            current = current.getSuperclass();
        }
        return methods.toArray(new Method[0]);
    }
}


