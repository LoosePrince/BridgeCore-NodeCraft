package com.bridgecore.agent.intercept;

import com.bridgecore.agent.logging.AgentLogger;
import java.lang.reflect.Method;
import java.util.*;
import java.util.Objects;

/**
 * 玩家列表拦截模块 - 用于拦截和提取在线玩家列表
 */
public final class PlayerListInterceptModule {
    private static PlayerListEventDispatcher dispatcher;
    private static PlayerInfoExtractor playerInfoExtractor;
    
    // 频率限制：最小间隔时间（毫秒）
    private static final long MIN_UPDATE_INTERVAL = 1000; // 1秒
    private static long lastUpdateTime = 0;
    
    // 缓存上次的玩家列表，用于检测变化
    private static List<Map<String, String>> lastPlayersList = new ArrayList<>();
    private static int lastPlayerCount = -1;

    private PlayerListInterceptModule() {}

    public static void initialize(PlayerListEventDispatcher eventDispatcher) {
        dispatcher = Objects.requireNonNull(eventDispatcher, "eventDispatcher");
        if (playerInfoExtractor == null) {
            playerInfoExtractor = new PlayerInfoExtractor();
        }
    }

    public static void setPlayerInfoExtractor(PlayerInfoExtractor extractor) {
        playerInfoExtractor = extractor;
    }

    /**
     * 处理玩家列表获取
     * @param playerList 玩家列表对象（可能是 Collection、List 或其他类型）
     * @return 是否成功处理
     */
    public static boolean handlePlayerList(Object playerList) {
        if (playerList == null || dispatcher == null) {
            return false;
        }

        try {
            // 频率限制：如果距离上次更新不足1秒，且列表为空，则跳过
            long currentTime = System.currentTimeMillis();
            boolean isThrottled = (currentTime - lastUpdateTime) < MIN_UPDATE_INTERVAL;
            
            List<Map<String, String>> players = extractPlayersFromList(playerList);
            int currentPlayerCount = players.size();
            
            // 如果列表为空且被限流，直接返回
            if (currentPlayerCount == 0 && isThrottled && lastPlayerCount == 0) {
                return false;
            }
            
            // 检查是否有变化（玩家数量或内容）
            boolean hasChanged = currentPlayerCount != lastPlayerCount;
            if (!hasChanged && currentPlayerCount > 0) {
                // 比较玩家列表内容
                hasChanged = !playersListEquals(players, lastPlayersList);
            }
            
            // 只有在有变化时才更新和输出日志
            if (hasChanged) {
                if (currentPlayerCount > 0) {
                    dispatcher.onPlayerListUpdate(players);
                    AgentLogger.debug("[PlayerListIntercept] 玩家列表更新: " + currentPlayerCount + " 个在线玩家");
                } else {
                    // 玩家列表变为空时也更新
                    dispatcher.onPlayerListUpdate(players);
                }
                
                lastUpdateTime = currentTime;
                lastPlayerCount = currentPlayerCount;
                lastPlayersList = new ArrayList<>(players);
            }
            // 如果没有变化，不更新也不输出日志，避免刷屏
            
            return true;
        } catch (Exception e) {
            AgentLogger.error("[PlayerListIntercept] 处理玩家列表时出错: " + e.getMessage(), e);
            return false;
        }
    }
    
    /**
     * 比较两个玩家列表是否相等
     */
    private static boolean playersListEquals(List<Map<String, String>> list1, List<Map<String, String>> list2) {
        if (list1.size() != list2.size()) {
            return false;
        }
        
        // 提取UUID集合进行比较
        Set<String> uuids1 = new HashSet<>();
        for (Map<String, String> player : list1) {
            String uuid = player.get("playerUuid");
            if (uuid != null && !uuid.equals("Unknown")) {
                uuids1.add(uuid);
            }
        }
        
        Set<String> uuids2 = new HashSet<>();
        for (Map<String, String> player : list2) {
            String uuid = player.get("playerUuid");
            if (uuid != null && !uuid.equals("Unknown")) {
                uuids2.add(uuid);
            }
        }
        
        return uuids1.equals(uuids2);
    }

    /**
     * 从玩家列表对象中提取玩家信息
     */
    private static List<Map<String, String>> extractPlayersFromList(Object playerList) {
        List<Map<String, String>> players = new ArrayList<>();
        
        try {
            // 尝试将对象转换为 Collection
            Collection<?> collection = null;
            
            if (playerList instanceof Collection) {
                collection = (Collection<?>) playerList;
            } else if (playerList.getClass().isArray()) {
                // 如果是数组，转换为 List
                collection = Arrays.asList((Object[]) playerList);
            } else {
                // 尝试调用 toArray() 或类似方法
                try {
                    Method toArray = playerList.getClass().getMethod("toArray");
                    Object[] array = (Object[]) toArray.invoke(playerList);
                    collection = Arrays.asList(array);
                } catch (Exception e) {
                    AgentLogger.debug("[PlayerListIntercept] 无法转换为集合: " + e.getMessage());
                }
            }
            
            if (collection == null) {
                AgentLogger.debug("[PlayerListIntercept] 无法识别玩家列表类型");
                return players;
            }
            
            // 遍历集合中的每个玩家对象
            for (Object playerObj : collection) {
                if (playerObj == null) {
                    continue;
                }
                
                Map<String, String> playerInfo = extractPlayerInfo(playerObj);
                if (playerInfo != null && !playerInfo.isEmpty()) {
                    players.add(playerInfo);
                }
            }
            
        } catch (Exception e) {
            AgentLogger.error("[PlayerListIntercept] 提取玩家列表时出错: " + e.getMessage(), e);
        }
        
        return players;
    }

    /**
     * 从单个玩家对象中提取信息
     */
    private static Map<String, String> extractPlayerInfo(Object player) {
        Map<String, String> info = new HashMap<>();
        info.put("playerName", "Unknown");
        info.put("playerUuid", "Unknown");
        
        if (player == null) {
            return info;
        }
        
        // 使用 PlayerInfoExtractor 提取玩家信息
        if (playerInfoExtractor != null) {
            Map<String, String> extracted = playerInfoExtractor.extract(player);
            info.putAll(extracted);
        }
        
        // 如果提取器没有成功，尝试直接提取
        if ("Unknown".equals(info.get("playerName"))) {
            try {
                // 尝试调用 getName() 方法
                Method getName = player.getClass().getMethod("getName");
                Object nameObj = getName.invoke(player);
                if (nameObj != null) {
                    info.put("playerName", nameObj.toString());
                }
            } catch (Exception e) {
                // 尝试其他方法名
                try {
                    Method getDisplayName = player.getClass().getMethod("getDisplayName");
                    Object nameObj = getDisplayName.invoke(player);
                    if (nameObj != null) {
                        info.put("playerName", nameObj.toString());
                    }
                } catch (Exception ignored) {}
            }
        }
        
        if ("Unknown".equals(info.get("playerUuid"))) {
            try {
                Method getUUID = player.getClass().getMethod("getUUID");
                Object uuidObj = getUUID.invoke(player);
                if (uuidObj != null) {
                    info.put("playerUuid", uuidObj.toString());
                }
            } catch (Exception e) {
                try {
                    Method getUniqueId = player.getClass().getMethod("getUniqueID");
                    Object uuidObj = getUniqueId.invoke(player);
                    if (uuidObj != null) {
                        info.put("playerUuid", uuidObj.toString());
                    }
                } catch (Exception ignored) {}
            }
        }
        
        return info;
    }

    /**
     * 玩家列表事件分发器接口
     */
    public interface PlayerListEventDispatcher {
        void onPlayerListUpdate(List<Map<String, String>> players);
    }
}

