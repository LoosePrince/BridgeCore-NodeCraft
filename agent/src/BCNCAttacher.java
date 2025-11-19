package com.bridgecore.agent;

import com.sun.tools.attach.VirtualMachine;
import com.sun.tools.attach.VirtualMachineDescriptor;
import java.util.List;

/**
 * BCNC Attacher - 将Agent附加到目标JVM进程
 */
public class BCNCAttacher {
    public static void main(String[] args) {
        try {
            if (args.length < 2) {
                System.err.println("用法: java BCNCAttacher <PID|auto> <agent.jar路径> [参数]");
                System.err.println("示例: java BCNCAttacher 12345 /path/to/agent.jar port=25575");
                System.err.println("      java BCNCAttacher auto /path/to/agent.jar port=25575");
                listJVMProcesses();
                System.exit(1);
            }
            
            String targetPID = args[0];
            String agentPath = args[1];
            String agentArgs = args.length > 2 ? args[2] : "port=25575";
            
            // 如果是auto，尝试自动查找Minecraft服务器进程
            if ("auto".equalsIgnoreCase(targetPID)) {
                targetPID = findMinecraftServer();
                if (targetPID == null) {
                    System.err.println("错误: 未找到Minecraft服务器进程");
                    System.err.println("可用的JVM进程:");
                    listJVMProcesses();
                    System.exit(1);
                }
                System.out.println("自动发现Minecraft服务器进程: PID=" + targetPID);
            }
            
            System.out.println("正在附加Agent到进程 " + targetPID + "...");
            System.out.println("Agent路径: " + agentPath);
            System.out.println("Agent参数: " + agentArgs);
            
            // 附加到目标JVM
            VirtualMachine vm = VirtualMachine.attach(targetPID);
            System.out.println("已连接到JVM");
            
            // 加载Agent
            vm.loadAgent(agentPath, agentArgs);
            System.out.println("Agent已成功注入!");
            
            // 断开连接
            vm.detach();
            System.out.println("已从JVM断开连接");
            
        } catch (Exception e) {
            System.err.println("注入失败: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
    
    /**
     * 查找Minecraft服务器进程
     */
    private static String findMinecraftServer() {
        List<VirtualMachineDescriptor> vms = VirtualMachine.list();
        
        for (VirtualMachineDescriptor vmd : vms) {
            String displayName = vmd.displayName().toLowerCase();
            // 查找包含server.jar、fabric-server、minecraft的进程
            if (displayName.contains("server.jar") || 
                displayName.contains("fabric-server") || 
                displayName.contains("minecraft") ||
                displayName.contains("nogui")) {
                // 排除自己
                if (!displayName.contains("bcncattacher")) {
                    return vmd.id();
                }
            }
        }
        
        return null;
    }
    
    /**
     * 列出所有JVM进程
     */
    private static void listJVMProcesses() {
        System.out.println("\n可用的JVM进程:");
        System.out.println("PID\t\t显示名称");
        System.out.println("----------------------------------------");
        
        List<VirtualMachineDescriptor> vms = VirtualMachine.list();
        for (VirtualMachineDescriptor vmd : vms) {
            System.out.println(vmd.id() + "\t\t" + vmd.displayName());
        }
        System.out.println();
    }
}

