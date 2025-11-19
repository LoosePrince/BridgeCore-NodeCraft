#!/bin/bash

echo ""
echo "========================================"
echo " BCNC Agent - 下载 ASM 库"
echo "========================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# 创建 lib 目录
if [ ! -d "$LIB_DIR" ]; then
    echo "[1/3] 创建 lib 目录..."
    mkdir -p "$LIB_DIR"
else
    echo "[1/3] lib 目录已存在"
fi

# ASM 库版本和URL
ASM_VERSION="9.6"
MAVEN_BASE="https://repo1.maven.org/maven2/org/ow2/asm"

ASM_JAR="asm-${ASM_VERSION}.jar"
ASM_COMMONS_JAR="asm-commons-${ASM_VERSION}.jar"

ASM_URL="${MAVEN_BASE}/asm/${ASM_VERSION}/${ASM_JAR}"
ASM_COMMONS_URL="${MAVEN_BASE}/asm-commons/${ASM_VERSION}/${ASM_COMMONS_JAR}"

# 检查并下载 asm.jar
if [ -f "$LIB_DIR/$ASM_JAR" ]; then
    echo "[2/3] $ASM_JAR 已存在，跳过下载"
else
    echo "[2/3] 正在下载 $ASM_JAR..."
    if command -v curl &> /dev/null; then
        curl -L "$ASM_URL" -o "$LIB_DIR/$ASM_JAR"
    elif command -v wget &> /dev/null; then
        wget "$ASM_URL" -O "$LIB_DIR/$ASM_JAR"
    else
        echo "[错误] 未找到 curl 或 wget，请手动下载"
        exit 1
    fi
    
    if [ $? -eq 0 ]; then
        echo "[成功] 已下载 $ASM_JAR"
    else
        echo "[错误] 下载失败: $ASM_JAR"
        exit 1
    fi
fi

# 检查并下载 asm-commons.jar
if [ -f "$LIB_DIR/$ASM_COMMONS_JAR" ]; then
    echo "[3/3] $ASM_COMMONS_JAR 已存在，跳过下载"
else
    echo "[3/3] 正在下载 $ASM_COMMONS_JAR..."
    if command -v curl &> /dev/null; then
        curl -L "$ASM_COMMONS_URL" -o "$LIB_DIR/$ASM_COMMONS_JAR"
    elif command -v wget &> /dev/null; then
        wget "$ASM_COMMONS_URL" -O "$LIB_DIR/$ASM_COMMONS_JAR"
    else
        echo "[错误] 未找到 curl 或 wget，请手动下载"
        exit 1
    fi
    
    if [ $? -eq 0 ]; then
        echo "[成功] 已下载 $ASM_COMMONS_JAR"
    else
        echo "[错误] 下载失败: $ASM_COMMONS_JAR"
        exit 1
    fi
fi

echo ""
echo "========================================"
echo " ASM 库下载完成！"
echo "========================================"
echo ""
echo "库文件位置: $LIB_DIR"
echo "  - $ASM_JAR"
echo "  - $ASM_COMMONS_JAR"
echo ""

