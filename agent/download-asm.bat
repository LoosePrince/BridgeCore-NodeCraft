@echo off
setlocal

echo.
echo ========================================
echo  BCNC Agent - 下载 ASM 库
echo ========================================
echo.

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0
set LIB_DIR=%SCRIPT_DIR%lib

REM 创建 lib 目录
if not exist "%LIB_DIR%" (
    echo [1/3] 创建 lib 目录...
    mkdir "%LIB_DIR%"
) else (
    echo [1/3] lib 目录已存在
)

REM ASM 库版本和URL
set ASM_VERSION=9.6
set MAVEN_BASE=https://repo1.maven.org/maven2/org/ow2/asm

set ASM_JAR=asm-%ASM_VERSION%.jar
set ASM_COMMONS_JAR=asm-commons-%ASM_VERSION%.jar

set ASM_URL=%MAVEN_BASE%/asm/%ASM_VERSION%/%ASM_JAR%
set ASM_COMMONS_URL=%MAVEN_BASE%/asm-commons/%ASM_VERSION%/%ASM_COMMONS_JAR%

REM 检查是否已下载
if exist "%LIB_DIR%\%ASM_JAR%" (
    echo [2/3] %ASM_JAR% 已存在，跳过下载
) else (
    echo [2/3] 正在下载 %ASM_JAR%...
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%ASM_URL%' -OutFile '%LIB_DIR%\%ASM_JAR%'}"
    if errorlevel 1 (
        echo [错误] 下载失败: %ASM_JAR%
        goto :error
    )
    echo [成功] 已下载 %ASM_JAR%
)

if exist "%LIB_DIR%\%ASM_COMMONS_JAR%" (
    echo [3/3] %ASM_COMMONS_JAR% 已存在，跳过下载
) else (
    echo [3/3] 正在下载 %ASM_COMMONS_JAR%...
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%ASM_COMMONS_URL%' -OutFile '%LIB_DIR%\%ASM_COMMONS_JAR%'}"
    if errorlevel 1 (
        echo [错误] 下载失败: %ASM_COMMONS_JAR%
        goto :error
    )
    echo [成功] 已下载 %ASM_COMMONS_JAR%
)

echo.
echo ========================================
echo  ASM 库下载完成！
echo ========================================
echo.
echo 库文件位置: %LIB_DIR%
echo   - %ASM_JAR%
echo   - %ASM_COMMONS_JAR%
echo.

goto :end

:error
echo.
echo ========================================
echo  下载失败！
echo ========================================
echo.
echo 请手动下载 ASM 库:
echo 1. 访问: https://repo1.maven.org/maven2/org/ow2/asm/
echo 2. 下载 asm-%ASM_VERSION%.jar 到 %LIB_DIR%
echo 3. 下载 asm-commons-%ASM_VERSION%.jar 到 %LIB_DIR%
echo.
exit /b 1

:end
endlocal

