@echo off
rem Runs a command on part of the CPU at below-normal priority, so a long simulation leaves the machine usable.
rem   scripts\selftest\capped.cmd node scripts\selftest\sweep.js --workers 25
rem CPU_MASK is the affinity mask in hex (one bit per logical CPU). Default 1FFFFFF = 25 of 32 logical CPUs, which
rem keeps the total load under 90% on this machine; 3 = two CPUs (while a game runs).
if "%CPU_MASK%"=="" set CPU_MASK=1FFFFFF
cd /d "%~dp0..\.."
start "" /b /wait /belownormal /affinity %CPU_MASK% %*
