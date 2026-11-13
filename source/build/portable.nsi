; Cut — version portable : un seul fichier .exe, sans installation.
; Au premier lancement, l'application est décompressée dans
; %LOCALAPPDATA%\Cut\Portable\<version> (quelques secondes), puis démarrée.
; Les lancements suivants sont immédiats.

Unicode true
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "Cut"
OutFile "${ROOT}\dist\Cut-${VERSION}-Portable.exe"
Icon "${ROOT}\assets\icon.ico"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
SetCompressorDictSize 64

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Cut"
VIAddVersionKey "FileDescription" "Cut (portable)"
VIAddVersionKey "CompanyName" "Krimossimo"
VIAddVersionKey "LegalCopyright" "© 2026 Krimossimo"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section
  StrCpy $0 "$LOCALAPPDATA\Cut\Portable\${VERSION}"
  ${IfNot} ${FileExists} "$0\.ready"
    Banner::show /set 76 "Cut" "Préparation du premier lancement…"
    RMDir /r "$0"
    SetOutPath "$0"
    File /r "${STAGE}\*.*"
    FileOpen $1 "$0\.ready" w
    FileWrite $1 "${VERSION}"
    FileClose $1
    Banner::destroy
  ${EndIf}
  ; Libère la place occupée par les copies d'anciennes versions.
  FindFirst $3 $4 "$LOCALAPPDATA\Cut\Portable\*"
  cleanloop:
    StrCmp $4 "" cleandone
    StrCmp $4 "." cleannext
    StrCmp $4 ".." cleannext
    StrCmp $4 "${VERSION}" cleannext
    RMDir /r "$LOCALAPPDATA\Cut\Portable\$4"
  cleannext:
    FindNext $3 $4
    Goto cleanloop
  cleandone:
  FindClose $3
  ${GetParameters} $2
  SetOutPath "$0"
  Exec '"$0\Cut.exe" $2'
SectionEnd
