; IPHealth 单文件便携版启动器
; 编译: makensis build/portable.nsi

Unicode true
Name "IPHealth"
OutFile "..\dist\IPHealth-1.0.0-win-x64-portable.exe"
Icon "icon.ico"

SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompress force
SetOverwrite on

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "IPHealth"
VIAddVersionKey "FileDescription" "代理池 IP 健康度检测工具"
VIAddVersionKey "CompanyName" "IPHealth"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 IPHealth"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "ProductVersion" "1.0.0"

Section "Main"
  SetOutPath "$TEMP\IPHealth-1.0.0"
  File /r "..\dist\win-unpacked\*.*"
  ExecWait '"$TEMP\IPHealth-1.0.0\IPHealth.exe"'
SectionEnd
