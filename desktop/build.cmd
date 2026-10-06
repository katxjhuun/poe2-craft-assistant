@echo off
rem Builds the desktop program into desktop\out: the page (node app\build.js), the helper (the C# compiler that ships
rem with Windows) and a copy of the page next to it. Nothing is downloaded.
setlocal
cd /d "%~dp0.."
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (echo The .NET Framework C# compiler was not found at %CSC% & exit /b 1)
call node app\build.js || exit /b 1
if not exist desktop\out mkdir desktop\out
"%CSC%" /nologo /target:winexe /optimize+ /out:desktop\out\PoE2CraftAssistant.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll desktop\PoE2CraftAssistant.cs || exit /b 1
if exist desktop\out\app rmdir /s /q desktop\out\app
xcopy /e /i /q /y app\dist desktop\out\app >nul || exit /b 1
echo Built desktop\out\PoE2CraftAssistant.exe
