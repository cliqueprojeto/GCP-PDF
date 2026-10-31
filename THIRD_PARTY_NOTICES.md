# Créditos e componentes de terceiros

GCP-PDF: desenvolvido por Bruno Albertini | Gestão Cultural Pro — https://gestaoculturalpro.com.br/
Distribuído sob a GNU General Public License, versão 3 ou posterior (arquivo LICENSE).

A identidade visual, o ícone e a interface do GCP-PDF são próprios. Nenhum ícone, fonte, imagem ou código do Adobe Acrobat ou do Wondershare PDFelement foi copiado.

## Componentes incluídos

- **Motor de edição de PDF** — baseado no PdfCraft CLI (ArtCraft Team e colaboradores do PdfCraft), sob MIT OU Apache-2.0. As licenças e o NOTICE originais estão em `assets/pdfcraft`. Este crédito não substitui os créditos dos autores do motor.
- **Fonte Inter** — SIL Open Font License 1.1 (`assets/OFL-Inter.txt`); a interface também usa o pacote `@fontsource/inter`, sob OFL.
- **Modelos de OCR em português, inglês e espanhol** (`por.traineddata`, `eng.traineddata`, `spa.traineddata`) — repositório oficial tesseract-ocr/tessdata_fast, tag 4.1.0, sob Apache-2.0 (`assets/tessdata/LICENSE`). O reconhecimento de texto roda no computador; nenhuma página é enviada para OCR remoto.
- **Dicionários de sinônimos** (`assets/dictionaries/synonyms-*.dat.gz`, formato MyThes dos dicionários do LibreOffice, convertidos para UTF-8): português do Brasil — Projeto VERO/Raimundo Moura e comunidade LibreOffice Brasil, LGPLv3 e MPL; espanhol — OpenThesaurus Tesauro Español (Marcelo Garrone), LGPL 2.1; inglês — th_en_US_v2 baseado no WordNet (Princeton University), licença WordNet.
- **Dicionários de tradução** (`assets/dictionaries/*-*.tsv.gz`) — WikDict (https://www.wikdict.com), dados dos colaboradores do Wiktionary, sob Creative Commons Atribuição-CompartilhaIgual 3.0. Detalhes e formato em `assets/dictionaries/LEIA-ME.txt`; gerados por `scripts/prepare-dictionaries.mjs`.
- **Bibliotecas** — Electron/Chromium, React, PDF.js, pdf-lib, fontkit, Lucide, docx, ExcelJS, PptxGenJS, Tesseract.js, @napi-rs/canvas, fflate, xmldom e QRCode, cada uma com sua licença no respectivo pacote. O `package-lock.json` fixa as versões e a integridade de cada dependência.

## Apoio ao projeto

O botão "Apoie o projeto" mostra um QR Code PIX (chave aleatória de doação do autor) e um link de doação pelo Stripe. O programa não processa pagamentos nem recebe dados bancários: o link só é aberto no navegador quando você clica.
