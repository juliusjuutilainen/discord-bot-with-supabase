@echo off
setlocal enabledelayedexpansion
:: register.bat — Register slash commands with Discord
:: Requires: curl (built-in on Windows 10+)
:: Usage: scripts\register.bat
::
:: Run this once after deploying. Re-running is safe — Discord upserts commands.
:: Global commands can take up to an hour to propagate; guild commands are instant.

:: Always run from repo root (script may be invoked from anywhere)
pushd "%~dp0.." || (
    echo [error] Failed to locate repository root.
    pause & exit /b 1
)

title Discord Bot — Register Slash Commands

echo ===============================================
echo   Discord Bot ^— Register Slash Commands
echo ===============================================
echo.

:: ─── Load .env ───────────────────────────────────────────────────────────────
if exist ".env" (
    for /f "usebackq tokens=1,* delims== eol=#" %%A in (".env") do (
        set "ENV_KEY=%%A"
        set "ENV_VAL=%%B"
        if defined ENV_KEY set "!ENV_KEY!=!ENV_VAL!"
    )
)

:: ─── Check dependencies ──────────────────────────────────────────────────────
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [error] curl not found. Update to Windows 10 1803+ or install curl manually.
    pause & exit /b 1
)
echo [ok]    curl: found
echo.

:: ─── Inputs ───────────────────────────────────────────────────────────────────
echo [Discord credentials]
echo   Bot token:       Discord Developer Portal -^> your app -^> Bot -^> Token
echo   Application ID:  Discord Developer Portal -^> your app -^> General Information
echo.

set "BOT_TOKEN_DEFAULT="
if defined discord_bot_token set "BOT_TOKEN_DEFAULT=!discord_bot_token!"
if "!BOT_TOKEN_DEFAULT!"=="" if defined BOT_TOKEN set "BOT_TOKEN_DEFAULT=!BOT_TOKEN!"
set "BOT_TOKEN=!BOT_TOKEN_DEFAULT!"

set "APP_ID_DEFAULT="
if defined discord_application_id set "APP_ID_DEFAULT=!discord_application_id!"
if "!APP_ID_DEFAULT!"=="" if defined discord_bot_client_id set "APP_ID_DEFAULT=!discord_bot_client_id!"
if "!APP_ID_DEFAULT!"=="" if defined APP_ID set "APP_ID_DEFAULT=!APP_ID!"
set "APP_ID=!APP_ID_DEFAULT!"

if defined BOT_TOKEN (
    set /p BOT_TOKEN_INPUT="  Bot token (press Enter to keep .env value):         "
    if not "!BOT_TOKEN_INPUT!"=="" set "BOT_TOKEN=!BOT_TOKEN_INPUT!"
) else (
    set /p BOT_TOKEN="  Bot token:         "
)

if defined APP_ID (
    set /p APP_ID_INPUT="  Application ID (press Enter to keep .env value):    "
    if not "!APP_ID_INPUT!"=="" set "APP_ID=!APP_ID_INPUT!"
) else (
    set /p APP_ID="  Application ID:    "
)

if "%BOT_TOKEN%"=="" ( echo [error] Bot token cannot be empty. & pause & exit /b 1 )
if "%APP_ID%"==""    ( echo [error] Application ID cannot be empty. & pause & exit /b 1 )

echo.
echo [Scope]
echo   [1] Global  ^— available in all servers (propagates in up to 60 min^)
echo   [2] Guild   ^— instant, one specific server (good for testing^)
echo.
set /p SCOPE_CHOICE="  Choose [1/2]: "

set GUILD_ID=
if "%SCOPE_CHOICE%"=="2" (
    echo.
    echo   Guild (server^) ID: right-click your server icon in Discord -^> Copy Server ID
    echo   (Enable Developer Mode in Discord Settings -^> Advanced if the option is missing^)
    if defined discord_guild_id set "GUILD_ID=!discord_guild_id!"
    if defined GUILD_ID (
        set /p GUILD_ID_INPUT="  Guild ID (press Enter to keep .env value): "
        if not "!GUILD_ID_INPUT!"=="" set "GUILD_ID=!GUILD_ID_INPUT!"
    ) else (
        set /p GUILD_ID="  Guild ID: "
    )
    if "!GUILD_ID!"=="" ( echo [error] Guild ID cannot be empty for guild scope. & pause & exit /b 1 )
)

:: ─── Build endpoint ────────────────────────────────────────────────────────────
if "%SCOPE_CHOICE%"=="2" (
    set ENDPOINT=https://discord.com/api/v10/applications/%APP_ID%/guilds/%GUILD_ID%/commands
    set SCOPE_LABEL=guild (ID: %GUILD_ID%^)
) else (
    set ENDPOINT=https://discord.com/api/v10/applications/%APP_ID%/commands
    set SCOPE_LABEL=global
)

echo.
echo [info]  Registering commands...
echo         Scope: %SCOPE_LABEL%
echo.

:: ─── /ask → grounded-llm-inference ───────────────────────────────────────────
echo [info]  Registering /ask (%SCOPE_LABEL%)...
curl -s -o "%TEMP%\discord_resp.json" -w "HTTP %%{http_code}" ^
    -X POST "%ENDPOINT%" ^
    -H "Content-Type: application/json" ^
    -H "Authorization: Bot %BOT_TOKEN%" ^
    -d "{\"name\":\"ask\",\"description\":\"Ask a question (Gemini + Google Search grounding)\",\"options\":[{\"name\":\"question\",\"description\":\"Your question\",\"type\":3,\"required\":true}]}"
echo.
if %errorlevel% neq 0 (
    echo [warn]  /ask — curl failed. Response:
    type "%TEMP%\discord_resp.json"
    echo.
) else (
    echo [ok]    /ask registered
)

:: ─── /openrouter → openrouter-llm-inference ──────────────────────────────────
:: Note: openrouter-llm-inference reads option name "query", not "question".
:: If you rename the option here, update the function too (and vice versa).
echo.
echo [info]  Registering /openrouter (%SCOPE_LABEL%)...
curl -s -o "%TEMP%\discord_resp.json" -w "HTTP %%{http_code}" ^
    -X POST "%ENDPOINT%" ^
    -H "Content-Type: application/json" ^
    -H "Authorization: Bot %BOT_TOKEN%" ^
    -d "{\"name\":\"openrouter\",\"description\":\"Ask a question via OpenRouter free models\",\"options\":[{\"name\":\"query\",\"description\":\"Your question\",\"type\":3,\"required\":true}]}"
echo.
if %errorlevel% neq 0 (
    echo [warn]  /openrouter — curl failed. Response:
    type "%TEMP%\discord_resp.json"
    echo.
) else (
    echo [ok]    /openrouter registered
)

:: ─── /settlethis → settle-this ───────────────────────────────────────────────
echo.
echo [info]  Registering /settlethis (%SCOPE_LABEL%)...
curl -s -o "%TEMP%\discord_resp.json" -w "HTTP %%{http_code}" ^
    -X POST "%ENDPOINT%" ^
    -H "Content-Type: application/json" ^
    -H "Authorization: Bot %BOT_TOKEN%" ^
    -d "{\"name\":\"settlethis\",\"description\":\"Judge the last 30 messages and decide who has the stronger case\"}"
echo.
if %errorlevel% neq 0 (
    echo [warn]  /settlethis — curl failed. Response:
    type "%TEMP%\discord_resp.json"
    echo.
) else (
    echo [ok]    /settlethis registered
)

:: ─── Add more commands here ───────────────────────────────────────────────────
:: Copy one of the curl blocks above, change the "name", "description", and
:: option "name"/"description" fields. Make sure "name" matches the key in
:: commandToFunction in discord-interactions/index.ts.

:: ─── Summary ──────────────────────────────────────────────────────────────────
echo.
echo ===============================================
echo   Done
echo ===============================================
echo.

if "%SCOPE_CHOICE%"=="2" (
    echo [ok]    Guild commands are available immediately.
) else (
    echo [warn]  Global commands can take up to 60 minutes to appear in Discord.
    echo         Tip: test with guild scope first, then re-run with global scope when ready.
)

echo.
echo   To add or rename commands: edit the curl blocks in this script and re-run.
echo   Discord upserts on name — safe to run multiple times.
echo.
popd
pause