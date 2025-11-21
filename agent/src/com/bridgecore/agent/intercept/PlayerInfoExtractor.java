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

        // 首先检查 handler 是否已经是 ServerPlayer 对象
        String serverPlayerObfuscated = mappingResolver != null ? 
            mappingResolver.getObfuscatedClassName("net.minecraft.server.level.ServerPlayer") : null;
        
        String handlerClassName = handler.getClass().getName();
        if (isServerPlayer(handlerClassName, serverPlayerObfuscated)) {
            PlayerIdentity playerIdentity = extractIdentityFromPlayer(handler);
            if (playerIdentity.hasData()) {
                return playerIdentity;
            }
        }
        
        // 方法0: 尝试调用返回 GameProfile 的方法
        try {
            // 尝试调用所有返回 GameProfile 的方法（无参数）
            for (Method method : handler.getClass().getDeclaredMethods()) {
                method.setAccessible(true);
                if (method.getParameterCount() == 0) {
                    Class<?> returnType = method.getReturnType();
                    String returnTypeName = returnType.getName();
                    if (returnTypeName.contains("GameProfile") || returnTypeName.contains("com.mojang.authlib")) {
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
        
        // 方法1: 尝试调用所有返回 ServerPlayer 的无参方法
        try {
            for (Method method : getAllMethods(handler.getClass())) {
                method.setAccessible(true);
                if (method.getParameterCount() == 0) {
                    Class<?> returnType = method.getReturnType();
                    if (returnType != null) {
                        String returnTypeName = returnType.getName();
                        if (isServerPlayer(returnTypeName, serverPlayerObfuscated)) {
                            Object playerObj = method.invoke(handler);
                            PlayerIdentity methodIdentity = extractIdentityFromPlayer(playerObj);
                            if (methodIdentity.hasData()) {
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
                
                boolean fieldLooksLikePlayer = field.getName().equalsIgnoreCase("player") ||
                    field.getName().toLowerCase().contains("player");
                
                // 检查是否是 ServerPlayer（通过映射表动态查找混淆名）
                if (fieldLooksLikePlayer || isServerPlayer(fieldClassName, serverPlayerObfuscated)) {
                    PlayerIdentity playerIdentity = extractIdentityFromPlayer(fieldValue);
                    if (playerIdentity.hasData()) {
                        return playerIdentity;
                    }
                }
            }
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

        // 方法1: 优先从 GameProfile 中提取（最可靠）
        try {
            int fieldCount = 0;
            boolean foundGameProfile = false;
            
            // 第一遍：只查找 GameProfile
            for (Field field : getAllFields(player.getClass())) {
                field.setAccessible(true);
                Object fieldValue = field.get(player);
                if (fieldValue == null) continue;
                
                fieldCount++;
                // 检查是否是 GameProfile
                Class<?> fieldClass = fieldValue.getClass();
                String fieldClassName = fieldClass.getName();
                
                if (fieldClassName.contains("GameProfile") || fieldClassName.contains("com.mojang.authlib")) {
                    PlayerIdentity profileIdentity = extractIdentityFromProfile(fieldValue);
                    identity.merge(profileIdentity);
                    foundGameProfile = true;
                    if (identity.hasData()) {
                        return identity;
                    }
                }
            }
            
            // 如果找到了 GameProfile 但提取失败，不再尝试从其他字段提取（避免提取错误信息）
            if (foundGameProfile && !identity.hasData()) {
                // GameProfile 存在但提取失败，可能是数据不完整，不再尝试其他方法
                return identity;
            }
        } catch (Exception e) {
            AgentLogger.debug("[PlayerExtractor] 遍历 ServerPlayer 字段时出错: " + e.getMessage());
        }
        
        // 方法2: 优先尝试 getGameProfile() 方法（最可靠的方法）
        if (!identity.hasData()) {
            try {
                Method getGameProfile = player.getClass().getMethod("getGameProfile");
                Object profile = getGameProfile.invoke(player);
                if (profile != null) {
                    PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
                    identity.merge(profileIdentity);
                    if (identity.hasData()) {
                        return identity;
                    }
                }
            } catch (Exception ignored) {
                // getGameProfile() 方法不存在，继续尝试其他方法
            }
        }
        
        // 方法3: 尝试调用所有返回 GameProfile 的方法
        if (!identity.hasData()) {
            try {
                for (Method method : getAllMethods(player.getClass())) {
                    method.setAccessible(true);
                    Class<?> returnType = method.getParameterCount() == 0 ? method.getReturnType() : null;
                    if (returnType != null && (returnType.getName().contains("GameProfile") || 
                        returnType.getName().contains("com.mojang.authlib"))) {
                        try {
                            Object profile = method.invoke(player);
                            PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
                            identity.merge(profileIdentity);
                            if (identity.hasData()) {
                                return identity;
                            }
                        } catch (Exception e) {
                            // 忽略单个方法调用失败
                        }
                    }
                }
            } catch (Exception e) {
                AgentLogger.debug("[PlayerExtractor] 遍历方法时出错: " + e.getMessage());
            }
        }
        
        // 方法4: 直接尝试常见的方法名获取名称和UUID（仅在 GameProfile 提取失败时使用）
        String[] nameMethodNames = {"getName", "getPlayerName", "getDisplayName", "getProfileName"};
        for (String methodName : nameMethodNames) {
            try {
                Method getName = player.getClass().getMethod(methodName);
                Object nameObj = getName.invoke(player);
                if (nameObj != null) {
                    String name = nameObj.toString();
                    if (name != null && !name.isEmpty() && !name.equals("Unknown")) {
                        identity.name = name;
                        break;
                    }
                }
            } catch (Exception ignored) {}
        }
        
        // 尝试获取 UUID
        String[] uuidMethodNames = {"getUUID", "getUniqueId", "getUniqueID", "getId"};
        for (String methodName : uuidMethodNames) {
            try {
                Method getUuid = player.getClass().getMethod(methodName);
                Object uuidObj = getUuid.invoke(player);
                if (uuidObj != null) {
                    String uuid = uuidObj.toString();
                    if (uuid != null && !uuid.isEmpty() && !uuid.equals("Unknown")) {
                        identity.uuid = uuid;
                        break;
                    }
                }
            } catch (Exception ignored) {}
        }
        
        // 如果还没有 UUID，尝试通过 GameProfile 获取
        if (identity.uuid == null || identity.uuid.equals("Unknown")) {
            try {
                // 尝试 getGameProfile() 方法
                Method getGameProfile = player.getClass().getMethod("getGameProfile");
                Object profile = getGameProfile.invoke(player);
                if (profile != null) {
                    PlayerIdentity profileIdentity = extractIdentityFromProfile(profile);
                    identity.merge(profileIdentity);
                }
            } catch (Exception ignored) {}
        }

        return identity;
    }

    private PlayerIdentity extractIdentityFromProfile(Object profile) {
        PlayerIdentity identity = new PlayerIdentity();
        if (profile == null) {
            return identity;
        }

        Class<?> profileClass = profile.getClass();

        // 优先尝试常见的方法名（最可靠）
        identity.name = invokeStringMethod(profile, "getName", "name");
        if (identity.uuid == null) {
            Object uuidObj = invokeMethod(profile, "getId", "getUUID", "id");
            if (uuidObj != null) {
                identity.uuid = uuidObj.toString();
            }
        }

        // 如果已经成功提取，直接返回
        if (identity.hasData()) {
            return identity;
        }

        // 尝试无参方法，但只尝试特定的方法名（避免从错误字段提取）
        String[] nameMethodCandidates = {"getName", "name", "getPlayerName", "getProfileName"};
        for (String methodName : nameMethodCandidates) {
            try {
                Method method = profileClass.getMethod(methodName);
                method.setAccessible(true);
                if (method.getParameterCount() == 0 && method.getReturnType() == String.class) {
                    Object value = method.invoke(profile);
                    if (value != null) {
                        String name = value.toString();
                        if (isValidPlayerName(name)) {
                            identity.name = name;
                            break;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        // 尝试 UUID 方法
        String[] uuidMethodCandidates = {"getId", "getUUID", "id", "uuid"};
        for (String methodName : uuidMethodCandidates) {
            try {
                Method method = profileClass.getMethod(methodName);
                method.setAccessible(true);
                if (method.getParameterCount() == 0) {
                    Class<?> returnType = method.getReturnType();
                    if (returnType.getName().equals("java.util.UUID") || returnType == String.class) {
                        Object value = method.invoke(profile);
                        if (value != null) {
                            String uuid = value.toString();
                            if (isValidUuid(uuid) || returnType.getName().equals("java.util.UUID")) {
                                identity.uuid = uuid;
                                break;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        // 最后尝试字段，但只从特定字段名中提取（避免从错误字段提取）
        if (!identity.hasData()) {
            String[] nameFieldCandidates = {"name", "playerName", "profileName"};
            String[] uuidFieldCandidates = {"id", "uuid", "uniqueId"};
            
            for (Field field : profileClass.getDeclaredFields()) {
                try {
                    field.setAccessible(true);
                    String fieldName = field.getName().toLowerCase();
                    Object value = field.get(profile);
                    
                    if (value instanceof String && identity.name == null) {
                        for (String candidate : nameFieldCandidates) {
                            if (fieldName.contains(candidate) && isValidPlayerName((String) value)) {
                                identity.name = (String) value;
                                break;
                            }
                        }
                    } else if (value instanceof java.util.UUID && identity.uuid == null) {
                        identity.uuid = value.toString();
                    } else if (value instanceof String && identity.uuid == null) {
                        for (String candidate : uuidFieldCandidates) {
                            if (fieldName.contains(candidate) && isValidUuid((String) value)) {
                                identity.uuid = ((String) value).toLowerCase();
                                break;
                            }
                        }
                    }
                    
                    if (identity.hasData()) {
                        break;
                    }
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
            identity.name = value;
        } else if (isValidUuid(value) && identity.uuid == null) {
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


