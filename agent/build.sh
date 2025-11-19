#!/bin/bash
# BCNC Agent 编译脚本 (Linux/Mac)

echo ""
echo "========================================"
echo " BCNC Agent - 编译"
echo "========================================"
echo ""

# 检测 JAVA_HOME
if [ -z "$JAVA_HOME" ]; then
    echo "[错误] JAVA_HOME 未设置"
    echo "请设置 JAVA_HOME 环境变量或使用完整的 JDK 路径"
    exit 1
fi

JAVAC="$JAVA_HOME/bin/javac"
JAR="$JAVA_HOME/bin/jar"

# 检查 javac 是否存在
if [ ! -f "$JAVAC" ]; then
    echo "[错误] javac 不存在: $JAVAC"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
ASM_JAR="$LIB_DIR/asm-9.6.jar"
ASM_COMMONS_JAR="$LIB_DIR/asm-commons-9.6.jar"

# 检查 ASM 库是否存在，不存在则自动下载
if [ ! -f "$ASM_JAR" ]; then
    echo "[ASM] ASM 库未找到，正在下载..."
    chmod +x "$SCRIPT_DIR/download-asm.sh"
    "$SCRIPT_DIR/download-asm.sh"
    if [ $? -ne 0 ]; then
        echo "[错误] ASM 库下载失败"
        exit 1
    fi
else
    echo "[ASM] ASM 库已存在"
fi

if [ ! -f "$ASM_COMMONS_JAR" ]; then
    echo "[错误] ASM Commons 库未找到"
    exit 1
fi

# 设置 Classpath (包含 ASM 库)
CLASSPATH="$ASM_JAR:$ASM_COMMONS_JAR"

# 创建输出目录
mkdir -p build
mkdir -p dist

echo ""
echo "[1/9] 编译日志模块..."
$JAVAC -d build -cp "$CLASSPATH:build" src/com/bridgecore/agent/logging/*.java
if [ $? -ne 0 ]; then
    echo "[错误] 日志模块编译失败"
    exit 1
fi

echo "[2/9] 编译工具模块..."
$JAVAC -d build -cp "$CLASSPATH:build" src/com/bridgecore/agent/utils/*.java
if [ $? -ne 0 ]; then
    echo "[错误] 工具模块编译失败"
    exit 1
fi

echo "[3/9] 编译注入模块 (MappingResolver)..."
$JAVAC -d build -cp "$CLASSPATH:build" src/com/bridgecore/agent/injection/MappingResolver.java
if [ $? -ne 0 ]; then
    echo "[错误] MappingResolver 编译失败"
    exit 1
fi

echo "[4/9] 编译拦截模块..."
$JAVAC -d build -cp "$CLASSPATH:build" src/com/bridgecore/agent/intercept/*.java
if [ $? -ne 0 ]; then
    echo "[错误] 拦截模块编译失败"
    exit 1
fi

echo "[5/9] 编译注入模块 (其余)..."
$JAVAC -d build -cp "$CLASSPATH:build" src/com/bridgecore/agent/injection/*.java
if [ $? -ne 0 ]; then
    echo "[错误] 注入模块编译失败"
    exit 1
fi

echo "[6/9] 编译 ChatInterceptorTransformer.java..."
$JAVAC -d build -cp "$CLASSPATH:build" src/ChatInterceptorTransformer.java
if [ $? -ne 0 ]; then
    echo "[错误] ChatInterceptorTransformer 编译失败"
    exit 1
fi

echo "[7/9] 编译 BCNCAgent.java..."
$JAVAC -d build -cp "$CLASSPATH:build" src/BCNCAgent.java
if [ $? -ne 0 ]; then
    echo "[错误] BCNCAgent 编译失败"
    exit 1
fi

echo "[8/9] 编译 BCNCAttacher.java..."
$JAVAC -d build -cp "$JAVA_HOME/lib/tools.jar" src/BCNCAttacher.java
if [ $? -ne 0 ]; then
    echo "[错误] BCNCAttacher 编译失败"
    exit 1
fi

# 解压 ASM 库到 build 目录
echo "[9/9] 合并 ASM 库..."
cd build
$JAR -xf "$ASM_JAR"
$JAR -xf "$ASM_COMMONS_JAR"
# 删除签名文件（避免冲突）
rm -f META-INF/*.SF META-INF/*.DSA META-INF/*.RSA 2>/dev/null
rm -f module-info.class */module-info.class 2>/dev/null
cd ..

# 打包 Agent JAR (包含 ASM 和 Transformer)
rm -f dist/bcnc-agent.jar dist/bcnc-attacher.jar

# 打包 Agent JAR (包含 ASM 和 Transformer)
echo "打包 bcnc-agent.jar (包含 ASM)..."
cd build
$JAR --create --file ../dist/bcnc-agent.jar --manifest ../src/MANIFEST.MF com/bridgecore/agent/ org/objectweb/asm/
if [ $? -ne 0 ]; then
    echo "[错误] Agent JAR 打包失败"
    cd ..
    exit 1
fi
cd ..

# 打包 Attacher JAR
echo "打包 bcnc-attacher.jar..."
cd build
$JAR --create --file ../dist/bcnc-attacher.jar --main-class com.bridgecore.agent.BCNCAttacher com/bridgecore/agent/BCNCAttacher.class
if [ $? -ne 0 ]; then
    echo "[错误] Attacher JAR 打包失败"
    cd ..
    exit 1
fi
cd ..

echo ""
echo "========================================"
echo " 编译成功！"
echo "========================================"
echo ""
echo "输出文件:"
echo "  - Agent:    $(pwd)/dist/bcnc-agent.jar"
echo "  - Attacher: $(pwd)/dist/bcnc-attacher.jar"
echo ""
echo "Agent 大小:"
ls -lh dist/bcnc-agent.jar | awk '{print "  约 " $5}'
echo ""
echo "已包含:"
echo "  ✓ BCNCAgent (核心)"
echo "  ✓ ChatInterceptorTransformer (拦截器)"
echo "  ✓ ASM 9.6 (字节码操作库)"
echo ""
exit 0

