; IPHealth 单文件便携版启动器
; 编译: makensis /DVERSION=1.0.x build/portable.nsi

Unicode true
Name "IPHealth"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif

OutFile "..\dist\IPHealth-${VERSION}-win-x64-portable.exe"
Icon "icon.ico"

SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompress force
SetOverwrite try

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "IPHealth"
VIAddVersionKey "FileDescription" "IPHealth"
VIAddVersionKey "CompanyName" "IPHealth"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 IPHealth"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section "Main"
  ; 每个版本解压到独立目录：
  ; 1) 旧版本还在运行时不会出现「文件被占用 → 覆盖失败 → 实际仍在跑旧 exe」的问题
  ; 2) 路径随版本变化，任务管理器的图标/名称缓存也会重新读取
  RMDir /r "$TEMP\IPHealth-${VERSION}"
  SetOutPath "$TEMP\IPHealth-${VERSION}"
  File /r "..\dist\win-unpacked\*.*"
  ExecWait '"$TEMP\IPHealth-${VERSION}\IPHealth.exe"'
SectionEnd
