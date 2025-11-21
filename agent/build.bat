@echo off
REM BCNC Agent 编译脚本 (Windows)

echo.
echo ========================================
echo  BCNC Agent - 编译
echo ========================================
echo.

REM 检测 JAVA_HOME
if not defined JAVA_HOME (
    echo [错误] JAVA_HOME 未设置
    echo 请设置 JAVA_HOME 环境变量或使用完整的 JDK 路径
    exit /b 1
)

set JAVAC="%JAVA_HOME%\bin\javac.exe"
set JAR="%JAVA_HOME%\bin\jar.exe"

REM 检查 javac 是否存在
if not exist %JAVAC% (
    echo [错误] javac 不存在: %JAVAC%
    exit /b 1
)

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0
set LIB_DIR=%SCRIPT_DIR%lib
set ASM_JAR=%LIB_DIR%\asm-9.6.jar
set ASM_COMMONS_JAR=%LIB_DIR%\asm-commons-9.6.jar

REM 检查 ASM 库是否存在，不存在则自动下载
if not exist "%ASM_JAR%" (
    echo [ASM] ASM 库未找到，正在下载...
    call "%SCRIPT_DIR%download-asm.bat"
    if errorlevel 1 (
        echo [错误] ASM 库下载失败
        exit /b 1
    )
) else (
    echo [ASM] ASM 库已存在
)

if not exist "%ASM_COMMONS_JAR%" (
    echo [错误] ASM Commons 库未找到
    exit /b 1
)

REM 设置 Classpath (包含 ASM 库)
set CLASSPATH=%ASM_JAR%;%ASM_COMMONS_JAR%

REM 创建输出目录
if not exist "build" mkdir build
if not exist "dist" mkdir dist

echo.
echo [1/12] 编译日志模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\logging\*.java
if errorlevel 1 (
    echo [错误] 日志模块编译失败
    exit /b 1
)

echo [2/12] 编译工具模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\utils\*.java
if errorlevel 1 (
    echo [错误] 工具模块编译失败
    exit /b 1
)

echo [3/12] 编译配置模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\config\*.java
if errorlevel 1 (
    echo [错误] 配置模块编译失败
    exit /b 1
)

echo [4/12] 编译异常模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\exception\*.java
if errorlevel 1 (
    echo [错误] 异常模块编译失败
    exit /b 1
)

echo [5/12] 编译注入模块基础类 (ServerType, MappingResolver)...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\injection\ServerType.java src\com\bridgecore\agent\injection\MappingResolver.java
if errorlevel 1 (
    echo [错误] 注入模块基础类编译失败
    exit /b 1
)

echo [6/12] 编译拦截模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\intercept\*.java
if errorlevel 1 (
    echo [错误] 拦截模块编译失败
    exit /b 1
)

echo [7/12] 编译核心模块...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\core\*.java
if errorlevel 1 (
    echo [错误] 核心模块编译失败
    exit /b 1
)

echo [8/12] 编译注入模块剩余类...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\injection\*.java
if errorlevel 1 (
    echo [错误] 注入模块剩余类编译失败
    exit /b 1
)

echo [9/12] 编译 BCNCAgent.java...
%JAVAC% -d build -cp "%CLASSPATH%;build" src\com\bridgecore\agent\BCNCAgent.java
if errorlevel 1 (
    echo [错误] BCNCAgent 编译失败
    exit /b 1
)

echo [10/12] 编译 BCNCAttacher.java...
%JAVAC% -d build -cp "%JAVA_HOME%\lib\tools.jar" src\BCNCAttacher.java
if errorlevel 1 (
    echo [错误] BCNCAttacher 编译失败
    exit /b 1
)

REM 解压 ASM 库到 build 目录
echo [11/12] 合并 ASM 库...
cd build
%JAR% -xf "%ASM_JAR%"
%JAR% -xf "%ASM_COMMONS_JAR%"
REM 删除签名文件（避免冲突）
if exist "META-INF\*.SF" del /Q "META-INF\*.SF"
if exist "META-INF\*.DSA" del /Q "META-INF\*.DSA"
if exist "META-INF\*.RSA" del /Q "META-INF\*.RSA"
REM 删除 module-info（避免模块冲突）
if exist "module-info.class" del /Q "module-info.class"
for /R %%F in (module-info.class) do del /Q "%%F"
cd ..

REM 打包 Agent JAR (包含 ASM 和 Transformer)
if exist "dist\bcnc-agent.jar" del /F /Q "dist\bcnc-agent.jar"
if exist "dist\bcnc-attacher.jar" del /F /Q "dist\bcnc-attacher.jar"

echo [12/12] 打包 JAR 文件...
echo 打包 bcnc-agent.jar (包含 ASM)...
cd build
%JAR% --create --file ..\dist\bcnc-agent.jar --manifest ..\src\MANIFEST.MF com\bridgecore\agent\ org\objectweb\asm\
if errorlevel 1 (
    echo [错误] Agent JAR 打包失败
    cd ..
    exit /b 1
)
cd ..

echo 打包 bcnc-attacher.jar...
cd build
%JAR% --create --file ..\dist\bcnc-attacher.jar --main-class com.bridgecore.agent.BCNCAttacher com\bridgecore\agent\BCNCAttacher.class
if errorlevel 1 (
    echo [错误] Attacher JAR 打包失败
    cd ..
    exit /b 1
)
cd ..

echo.
echo ========================================
echo  编译成功！
echo ========================================
echo.
echo 输出文件:
echo   - Agent:    %CD%\dist\bcnc-agent.jar
echo   - Attacher: %CD%\dist\bcnc-attacher.jar
echo.
echo Agent 大小:
dir /B dist\bcnc-agent.jar | findstr /V "^$"
for %%A in (dist\bcnc-agent.jar) do echo   约 %%~zA 字节
echo.
echo 已包含:
echo   ✓ BCNCAgent (核心)
echo   ✓ ChatInterceptorTransformer (聊天拦截器)
echo   ✓ PlayerListInterceptorTransformer (玩家列表拦截器)
echo   ✓ ASM 9.6 (字节码操作库)
echo.
exit /b 0

