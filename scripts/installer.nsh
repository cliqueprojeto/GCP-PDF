!macro customHeader
 BrandingText "GCP-PDF · Desenvolvido por Bruno Albertini · Gestão Cultural Pro"
 !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao GCP-PDF"
 !define MUI_WELCOMEPAGE_TEXT "Desenvolvido por Bruno Albertini · Gestão Cultural Pro.$\r$\n$\r$\nO editor de PDF da Gestão Cultural Pro: edite textos e imagens direto na página, converta para Word, Excel e PowerPoint, assine com certificado ICP-Brasil, preencha formulários e use OCR em português.$\r$\n$\r$\nSeus arquivos ficam no seu computador — nada é enviado sem você pedir.$\r$\n$\r$\nClique em Avançar para continuar."
 !define MUI_FINISHPAGE_TITLE "Tudo pronto!"
 !define MUI_FINISHPAGE_TEXT "O GCP-PDF foi instalado. Desenvolvido por Bruno Albertini.$\r$\n$\r$\nNo Explorador de Arquivos, clique com o botão direito em PDFs, imagens ou documentos do Office para Converter para PDF ou Combinar em um PDF (no Windows 11, em Mostrar mais opções)."
 !define MUI_FINISHPAGE_RUN_TEXT "Abrir o GCP-PDF agora"
 !define MUI_FINISHPAGE_LINK "Conheça a Gestão Cultural Pro"
 !define MUI_FINISHPAGE_LINK_LOCATION "https://gestaoculturalpro.com.br/"
!macroend
!macro customWelcomePage
 !insertmacro MUI_PAGE_WELCOME
!macroend
!macro customInstall
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF" "MUIVerb" "GCP-PDF"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF" "SubCommands" ""
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF" "Icon" '"$INSTDIR\GCP-PDF.exe",0'
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\convert" "MUIVerb" "Converter para PDF"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\convert" "Icon" "$INSTDIR\resources\app.asar.unpacked\assets\context\convert.ico"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\convert" "MultiSelectModel" "Player"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\convert\command" "" '"$INSTDIR\GCP-PDF.exe" --quick-convert "%1"'
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\combine" "MUIVerb" "Combinar em um PDF"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\combine" "Icon" "$INSTDIR\resources\app.asar.unpacked\assets\context\combine.ico"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\combine" "MultiSelectModel" "Player"
 WriteRegStr HKCU "Software\Classes\*\shell\GCPPDF\shell\combine\command" "" '"$INSTDIR\GCP-PDF.exe" --quick-combine "%1"'
!macroend
!macro customUnInstall
 DeleteRegKey HKCU "Software\Classes\*\shell\GCPPDF"
!macroend
