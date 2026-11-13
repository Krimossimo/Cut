; Cut — installateur Windows (NSIS)
; Installation par utilisateur (aucun droit administrateur requis) dans
; %LOCALAPPDATA%\Programs\Cut, raccourcis Bureau + menu Démarrer,
; entrée « Applications installées » et désinstallation propre.

Unicode true
!addplugindir "${PLUGINS}"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APPNAME   "Cut"
!define PUBLISHER "Krimossimo"
!define APPID     "com.krimossimo.cut"
!define EXE       "Cut.exe"
!define UNINSTEXE "Desinstaller Cut.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME}"
Caption "Installation de ${APPNAME} ${VERSION}"
OutFile "${ROOT}\dist\Cut-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ShowInstDetails nevershow
ShowUninstDetails nevershow
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de ${APPNAME}"
VIAddVersionKey /LANG=1036 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© 2026 ${PUBLISHER}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"

; --- Apparence
!define MUI_ICON   "${ROOT}\assets\icon.ico"
!define MUI_UNICON "${ROOT}\assets\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP   "${ROOT}\assets\installer-welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ROOT}\assets\installer-welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP   "${ROOT}\assets\installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${ROOT}\assets\installer-header.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Bienvenue dans l'installation de Cut"
!define MUI_WELCOMEPAGE_TEXT "Cut découpe vos VOD Twitch et vos vidéos en quelques secondes, sans réencodage et sans perte de qualité.$\r$\n$\r$\nAucun droit administrateur n'est nécessaire. FFmpeg est inclus : rien d'autre à installer.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
!define MUI_FINISHPAGE_TITLE "Cut est installé"
!define MUI_FINISHPAGE_TEXT "Un raccourci a été ajouté sur votre Bureau et dans le menu Démarrer."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer Cut maintenant"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

; ------------------------------------------------------------------ Installation
Section "Cut" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Cut ne doit pas être en cours d'exécution pendant la mise à jour.
  retry:
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    ClearErrors
    Delete "$INSTDIR\${EXE}"
    ${If} ${Errors}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Cut est en cours d'exécution.$\r$\nFermez Cut puis cliquez sur Réessayer." /SD IDCANCEL IDRETRY retry
      Abort "Installation annulée : Cut est en cours d'exécution."
    ${EndIf}
    ; Mise à jour : retire les anciens fichiers de l'application.
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\locales"
  ${EndIf}

  File /r "${STAGE}\*.*"

  WriteUninstaller "$INSTDIR\${UNINSTEXE}"

  ; Raccourcis (avec l'identifiant d'application pour un épinglage correct dans la barre des tâches)
  CreateShortCut "$DESKTOP\Cut.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Découper des vidéos sans perte"
  CreateShortCut "$SMPROGRAMS\Cut.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Découper des vidéos sans perte"
  WinShell::SetLnkAUMI "$DESKTOP\Cut.lnk" "${APPID}"
  WinShell::SetLnkAUMI "$SMPROGRAMS\Cut.lnk" "${APPID}"

  ; Entrée « Applications installées »
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINSTEXE}"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTEXE}" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"

  ; Rafraîchit les icônes de l'Explorateur
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd

; ------------------------------------------------------------------ Désinstallation
Section "Uninstall"
  uretry:
  ClearErrors
  Delete "$INSTDIR\${EXE}"
  ${If} ${Errors}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Cut est en cours d'exécution.$\r$\nFermez Cut puis cliquez sur Réessayer." /SD IDCANCEL IDRETRY uretry
    Abort "Désinstallation annulée : Cut est en cours d'exécution."
  ${EndIf}

  Delete "$DESKTOP\Cut.lnk"
  Delete "$SMPROGRAMS\Cut.lnk"

  ; Supprime uniquement les fichiers installés par Cut
!include "${ROOT}\build\uninstall-files.nsh"
  Delete "$INSTDIR\${UNINSTEXE}"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"

  ; Caches de l'application (toujours supprimés)
  RMDir /r "$LOCALAPPDATA\Cut"

  ; Paramètres : sur demande
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Supprimer aussi vos paramètres Cut (dossier d'export, volume…) ?" IDNO keepsettings
    RMDir /r "$APPDATA\Cut"
    keepsettings:
  ${EndIf}

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
