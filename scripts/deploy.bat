@echo off
setlocal enabledelayedexpansion
:: deploy.bat — Deploy Discord bot Edge Functions to Supabase
:: Requires: Node.js / npx (for supabase CLI), curl (built-in on Windows 10+)
:: Usage: scripts\deploy.bat

:: Always run from repo root (script may be invoked from anywhere)
pushd "%~dp0.." || (
    echo [error] Failed to locate repository root.
    pause & exit /b 1
)

title Supabase Discord Bot — Deploy

echo ===============================================
echo   Supabase Discord Bot ^— Deploy (Windows)
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
echo [info]  Checking dependencies...

where npx >nul 2>&1
if %errorlevel% neq 0 (
    echo [error] npx not found. Install Node.js from https://nodejs.org/
    pause & exit /b 1
)
echo [ok]    npx: found

where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [error] curl not found. Update to Windows 10 1803+ or install curl manually.
    pause & exit /b 1
)
echo [ok]    curl: found
echo.

:: ─── Project ref ─────────────────────────────────────────────────────────────
echo [Project reference]
echo   Find it in: Supabase Dashboard ^-^> Project Settings ^-^> General
echo   It is the first part of your project URL, e.g. abcdefghijkl
echo.
set "PROJECT_REF="
if defined SUPABASE_PROJECT_REF set "PROJECT_REF=!SUPABASE_PROJECT_REF!"
if defined supabase_project_ref set "PROJECT_REF=!supabase_project_ref!"

if defined PROJECT_REF (
    echo   Found project ref in .env.
    set /p PROJECT_REF_INPUT="  Enter your Supabase project reference (press Enter to keep .env value): "
    if not "!PROJECT_REF_INPUT!"=="" set "PROJECT_REF=!PROJECT_REF_INPUT!"
) else (
    set /p PROJECT_REF="  Enter your Supabase project reference: "
)

if "%PROJECT_REF%"=="" (
    echo [error] Project reference cannot be empty.
    pause & exit /b 1
)

:: ─── Secrets ──────────────────────────────────────────────────────────────────
echo.
echo [Secrets]
echo   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
echo   Leave a value blank to skip setting it.
echo.

set "SECRET_DISCORD_PK="
if defined discord_public_key set "SECRET_DISCORD_PK=!discord_public_key!"
if defined discord_bot_public_key set "SECRET_DISCORD_PK=!discord_bot_public_key!"

set "SECRET_DISCORD_APP_ID="
if defined discord_application_id set "SECRET_DISCORD_APP_ID=!discord_application_id!"
if defined discord_bot_client_id set "SECRET_DISCORD_APP_ID=!discord_bot_client_id!"

set "SECRET_DISCORD_BOT_TOKEN="
if defined discord_bot_token set "SECRET_DISCORD_BOT_TOKEN=!discord_bot_token!"

set "SECRET_GEMINI="
if defined gemini_api_key set "SECRET_GEMINI=!gemini_api_key!"

set "SECRET_OPENROUTER="
if defined openrouter_api_key set "SECRET_OPENROUTER=!openrouter_api_key!"

set "SECRET_JINA="
if defined jina_api_key set "SECRET_JINA=!jina_api_key!"

if defined SECRET_DISCORD_PK (
    set /p SECRET_DISCORD_PK_INPUT="  discord_public_key (press Enter to keep .env value):      "
    if not "!SECRET_DISCORD_PK_INPUT!"=="" set "SECRET_DISCORD_PK=!SECRET_DISCORD_PK_INPUT!"
) else (
    set /p SECRET_DISCORD_PK="  discord_public_key:      "
)

if defined SECRET_DISCORD_APP_ID (
    set /p SECRET_DISCORD_APP_ID_INPUT="  discord_application_id (press Enter to keep .env value):  "
    if not "!SECRET_DISCORD_APP_ID_INPUT!"=="" set "SECRET_DISCORD_APP_ID=!SECRET_DISCORD_APP_ID_INPUT!"
) else (
    set /p SECRET_DISCORD_APP_ID="  discord_application_id:  "
)

if defined SECRET_DISCORD_BOT_TOKEN (
    set /p SECRET_DISCORD_BOT_TOKEN_INPUT="  discord_bot_token (press Enter to keep .env value):      "
    if not "!SECRET_DISCORD_BOT_TOKEN_INPUT!"=="" set "SECRET_DISCORD_BOT_TOKEN=!SECRET_DISCORD_BOT_TOKEN_INPUT!"
) else (
    set /p SECRET_DISCORD_BOT_TOKEN="  discord_bot_token:      "
)

if defined SECRET_GEMINI (
    set /p SECRET_GEMINI_INPUT="  gemini_api_key (press Enter to keep .env value):          "
    if not "!SECRET_GEMINI_INPUT!"=="" set "SECRET_GEMINI=!SECRET_GEMINI_INPUT!"
) else (
    set /p SECRET_GEMINI="  gemini_api_key:          "
)

if defined SECRET_OPENROUTER (
    set /p SECRET_OPENROUTER_INPUT="  openrouter_api_key (press Enter to keep .env value):      "
    if not "!SECRET_OPENROUTER_INPUT!"=="" set "SECRET_OPENROUTER=!SECRET_OPENROUTER_INPUT!"
) else (
    set /p SECRET_OPENROUTER="  openrouter_api_key:      "
)

if defined SECRET_JINA (
    set /p SECRET_JINA_INPUT="  jina_api_key (press Enter to keep .env value):            "
    if not "!SECRET_JINA_INPUT!"=="" set "SECRET_JINA=!SECRET_JINA_INPUT!"
) else (
    set /p SECRET_JINA="  jina_api_key:            "
)

:: ─── Login + link ─────────────────────────────────────────────────────────────
echo.
echo [info]  Logging in to Supabase...
npx supabase@2.75.0 login
if %errorlevel% neq 0 ( echo [error] Login failed. & pause & exit /b 1 )

echo [info]  Linking project %PROJECT_REF%...
npx supabase@2.75.0 link --project-ref %PROJECT_REF%
if %errorlevel% neq 0 ( echo [error] Link failed. Check your project reference. & pause & exit /b 1 )

:: ─── Push secrets ─────────────────────────────────────────────────────────────
echo.
echo [info]  Pushing secrets...

:: Build the secrets string — only include non-empty values
set SECRETS_CMD=npx supabase@2.75.0 secrets set
set SECRETS_COUNT=0

if not "%SECRET_DISCORD_PK%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! discord_public_key=%SECRET_DISCORD_PK%
    set /a SECRETS_COUNT+=1
)
if not "%SECRET_DISCORD_APP_ID%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! discord_application_id=%SECRET_DISCORD_APP_ID%
    set /a SECRETS_COUNT+=1
)
if not "%SECRET_DISCORD_BOT_TOKEN%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! discord_bot_token=%SECRET_DISCORD_BOT_TOKEN%
    set /a SECRETS_COUNT+=1
)
if not "%SECRET_GEMINI%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! gemini_api_key=%SECRET_GEMINI%
    set /a SECRETS_COUNT+=1
)
if not "%SECRET_OPENROUTER%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! openrouter_api_key=%SECRET_OPENROUTER%
    set /a SECRETS_COUNT+=1
)
if not "%SECRET_JINA%"=="" (
    set SECRETS_CMD=!SECRETS_CMD! jina_api_key=%SECRET_JINA%
    set /a SECRETS_COUNT+=1
)

if %SECRETS_COUNT% gtr 0 (
    %SECRETS_CMD%
    if %errorlevel% neq 0 ( echo [warn]  Secrets push failed. Set them manually in the Supabase dashboard. )
    echo [ok]    Secrets pushed: %SECRETS_COUNT% secret(s^)
) else (
    echo [warn]  No secrets entered — skipping. Set them manually in the Supabase dashboard.
)

:: ─── Deploy functions ─────────────────────────────────────────────────────────
echo.
echo [info]  Deploying Edge Functions...
echo   Note: --no-verify-jwt is required on all functions so Discord can POST
echo         without a Supabase auth token.
echo.

set FAILED_FUNCTIONS=

echo [info]  Deploying discord-interactions...
npx supabase@2.75.0 functions deploy discord-interactions --no-verify-jwt
if %errorlevel% neq 0 (
    echo [warn]  discord-interactions failed
    set FAILED_FUNCTIONS=!FAILED_FUNCTIONS! discord-interactions
) else (
    echo [ok]    discord-interactions deployed
)

echo [info]  Deploying grounded-llm-inference...
npx supabase@2.75.0 functions deploy grounded-llm-inference --no-verify-jwt
if %errorlevel% neq 0 (
    echo [warn]  grounded-llm-inference failed
    set FAILED_FUNCTIONS=!FAILED_FUNCTIONS! grounded-llm-inference
) else (
    echo [ok]    grounded-llm-inference deployed
)

echo [info]  Deploying openrouter-llm-inference...
npx supabase@2.75.0 functions deploy openrouter-llm-inference --no-verify-jwt
if %errorlevel% neq 0 (
    echo [warn]  openrouter-llm-inference failed
    set FAILED_FUNCTIONS=!FAILED_FUNCTIONS! openrouter-llm-inference
) else (
    echo [ok]    openrouter-llm-inference deployed
)

echo [info]  Deploying gemini-grounded-llm-inference...
npx supabase@2.75.0 functions deploy gemini-grounded-llm-inference --no-verify-jwt
if %errorlevel% neq 0 (
    echo [warn]  gemini-grounded-llm-inference failed
    set FAILED_FUNCTIONS=!FAILED_FUNCTIONS! gemini-grounded-llm-inference
) else (
    echo [ok]    gemini-grounded-llm-inference deployed
)

echo [info]  Deploying settle-this...
npx supabase@2.75.0 functions deploy settle-this --no-verify-jwt
if %errorlevel% neq 0 (
    echo [warn]  settle-this failed
    set FAILED_FUNCTIONS=!FAILED_FUNCTIONS! settle-this
) else (
    echo [ok]    settle-this deployed
)

:: ─── Summary ──────────────────────────────────────────────────────────────────
echo.
echo ===============================================
echo   Done
echo ===============================================
echo.

if not "%FAILED_FUNCTIONS%"=="" (
    echo [warn]  The following functions failed to deploy:
    for %%F in (%FAILED_FUNCTIONS%) do echo          - %%F
    echo.
)

echo   Interactions Endpoint URL (set this in the Discord Developer Portal^):
echo     https://%PROJECT_REF%.supabase.co/functions/v1/discord-interactions?apikey=^<YOUR_ANON_KEY^>
echo.
echo   Find your anon key at:
echo     Supabase Dashboard -^> Settings -^> API -^> Project API keys -^> Publishable key
echo.
echo   Manual steps still required:
echo     1. Run the SQL migration in the Supabase SQL Editor
echo        (supabase/migrations/20260311000000_create_query_cache.sql^)
echo     2. Set the Interactions Endpoint URL in the Discord Developer Portal
echo     3. Register your slash command (use scripts\register.bat^)
echo.
popd
pause