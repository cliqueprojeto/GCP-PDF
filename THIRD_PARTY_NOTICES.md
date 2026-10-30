# Créditos e componentes de terceiros

GCP-PDF: desenvolvido por Bruno Albertini | Gestão Cultural Pro.
https://gestaoculturalpro.com.br/

A identidade visual, o ícone vetorial e a interface do GCP-PDF são novos. Nenhum ícone, fonte, imagem ou código do Adobe Acrobat ou do Wondershare PDFelement foi copiado. As capturas fornecidas pelo usuário foram referências de funcionalidades.

O motor de edição de texto existente inclui o PdfCraft CLI, mantido por seus autores e colaboradores, sob MIT OU Apache-2.0. O executável foi obtido da instalação local indicada pelo usuário. As licenças e o NOTICE originais estão em assets/pdfcraft. O código-fonte fornecido está em ../Outros arquivos/pdfcraft-main, fora deste projeto. O crédito do GCP-PDF não substitui os créditos dos autores desse motor.

A fonte Inter está sob SIL Open Font License 1.1; arquivo de licença em assets/OFL-Inter.txt. Sua cópia foi obtida de assets/fonts do código-fonte do PdfCraft indicado pelo usuário, com licença incluída. A interface utiliza adicionalmente o pacote @fontsource/inter sob OFL.

O modelo por.traineddata foi obtido do repositório oficial tesseract-ocr/tessdata_fast, tag 4.1.0, sob Apache-2.0. Licença em assets/tessdata/LICENSE. O modelo é distribuído localmente; nenhuma página é enviada para OCR remoto.

As dependências são distribuídas com suas licenças nos respectivos pacotes em node_modules: Electron/Chromium, React, PDF.js, pdf-lib, fontkit, Lucide, docx, ExcelJS, PptxGenJS, Tesseract.js, @napi-rs/canvas e QRCode. O package-lock.json fixa suas versões e integridades.

O payload PIX e o link Stripe foram fornecidos expressamente pelo usuário. O QR Code codifica exatamente o payload informado; seu CRC-16 foi validado (2B27). O aplicativo não processa pagamentos nem recebe dados bancários: a ação Stripe abre o checkout externo somente quando solicitada.
