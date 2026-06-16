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

; 卸载时（非升级、且用户勾选了"删除应用数据"）清理运行时在安装目录下生成的数据。
; 这些目录是程序运行时创建的，不在安装器的文件清单内，默认卸载不会删除，
; 导致 $INSTDIR 残留 config/jobs/preview/pic。这里在内置数据清理后补删，
; 最后再尝试移除已为空的 $INSTDIR。
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\config"
    RMDir /r "$INSTDIR\jobs"
    RMDir /r "$INSTDIR\preview"
    RMDir /r "$INSTDIR\pic"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
