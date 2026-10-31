; IPHealth 单文件便携版启动器
; 编译: makensis build/portable.nsi

Unicode true
Name "IPHealth"
!ifndef VERSION
  !define VERSION "1.0.1"
!endif

OutFile "..\dist\IPHealth-${VERSION}-win-x64-portable.exe"
Icon "icon.ico"

SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompress force
SetOverwrite on

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "IPHealth"
VIAddVersionKey "FileDescription" "IPHealth"
VIAddVersionKey "CompanyName" "IPHealth"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 IPHealth"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section "Main"
  SetOutPath "$TEMP\IPHealth-1.0.0"
  File /r "..\dist\win-unpacked\*.*"
  ExecWait '"$TEMP\IPHealth-1.0.0\IPHealth.exe"'
SectionEnd
