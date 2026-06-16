!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\config"
  ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
    FileOpen $0 "$INSTDIR\config\install.json" w
    FileWrite $0 '{"locale":"zh_CN"}'
    FileClose $0
  ${Else}
    FileOpen $0 "$INSTDIR\config\install.json" w
    FileWrite $0 '{"locale":"en_US"}'
    FileClose $0
  ${EndIf}
!macroend
