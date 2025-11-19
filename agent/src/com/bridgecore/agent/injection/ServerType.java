package com.bridgecore.agent.injection;

import java.lang.instrument.Instrumentation;

/**
 * 服务端类型枚举
 */
public enum ServerType {
    VANILLA("Vanilla", "原版"),
    FABRIC("Fabric", "Fabric"),
    FORGE("Forge", "Forge"),
    QUILT("Quilt", "Quilt"),
    PAPER("Paper", "Paper"),
    SPIGOT("Spigot", "Spigot"),
    BUKKIT("Bukkit", "Bukkit"),
    UNKNOWN("Unknown", "未知");

    private final String id;
    private final String displayName;

    ServerType(String id, String displayName) {
        this.id = id;
        this.displayName = displayName;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    /**
     * 自动检测服务端类型
     */
    public static ServerType detect(Instrumentation inst) {
        Class<?>[] allClasses = inst.getAllLoadedClasses();
        boolean foundPaper = false;
        boolean foundSpigot = false;
        boolean foundBukkit = false;

        for (Class<?> clazz : allClasses) {
            String name = clazz.getName();

            if (startsWithAny(name,
                    "net.fabricmc.", "fabric.", "com.mojang.blaze3d.platform.Fabric")) {
                return FABRIC;
            }

            if (startsWithAny(name,
                    "org.quiltmc.", "net.qfapi.", "org.quiltmc.loader.")) {
                return QUILT;
            }

            if (startsWithAny(name,
                    "net.minecraftforge.", "cpw.mods.", "cpw.modlauncher.",
                    "net.minecraftforge.fml.", "net.minecraftforge.server.")) {
                return FORGE;
            }

            if (startsWithAny(name,
                    "com.destroystokyo.paper.", "io.papermc.paper.", "io.papermc.paperclip.")) {
                foundPaper = true;
                continue;
            }

            if (name.startsWith("org.spigotmc.")) {
                foundSpigot = true;
                continue;
            }

            if (name.startsWith("org.bukkit.") || name.startsWith("net.minecraft.server.v")) {
                foundBukkit = true;
            }
        }

        if (foundPaper) {
            return PAPER;
        }
        if (foundSpigot) {
            return SPIGOT;
        }
        if (foundBukkit) {
            return BUKKIT;
        }

        // 默认返回 VANILLA（可能是原版或未检测到）
        return VANILLA;
    }

    private static boolean startsWithAny(String name, String... prefixes) {
        for (String prefix : prefixes) {
            if (name.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }
}

