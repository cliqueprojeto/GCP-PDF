# GCP-PDF para Android

O GCP-PDF completo para celulares e tablets Android 8.0 ou mais recente, em retrato e paisagem. Não é uma reescrita: é **o mesmo código do computador** — a interface React e o processo principal (`src/main`) com todos os motores — executado no motor Chromium do próprio Android, com uma camada nativa em Kotlin no lugar do Electron e uma apresentação feita para o toque.

Desenvolvido por **Bruno Albertini | [Gestão Cultural Pro](https://gestaoculturalpro.com.br/)**.

## O que o usuário encontra

- **Celular**: barra superior (voltar, documento e página, desfazer/refazer, pesquisa e menu ⋮), documento em tela cheia ajustado à largura, as 11 categorias do computador (Início, Editar, Comentário, Organizar, Formulário, Converter, Assinar, Proteger, Revisar, Exibição, IA) como pílulas na parte de baixo e as ferramentas da categoria logo acima. Tocar de novo na categoria ativa recolhe as ferramentas.
- Painéis (páginas, marcadores, pesquisa, comentários, assinaturas, IA), propriedades, diálogos e menus viram **folhas deslizantes** de baixo para cima. O botão Voltar do Android fecha primeiro o que estiver aberto.
- **Pinça para zoom**, rolagem contínua, toque longo no texto seleciona a palavra (as alças do Android ampliam a seleção) e abre as ações do computador: copiar, destacar, sublinhar, tachar, comentar, marcador, tarja, sinônimos e tradução.
- **Tablet** e celular deitado: o layout compacto vale para telas estreitas ou baixas; tablets na horizontal recebem o layout do computador com alvos de toque maiores.
- Arquivos pelo seletor do Android (Downloads, cartão, Google Drive, WhatsApp…), **Abrir com** e **Compartilhar com o GCP-PDF**. Salvar grava no próprio arquivo escolhido; Salvar como e as exportações pedem o destino. Menu ⋮ › Compartilhar envia o documento como está (inclusive edições não salvas).
- **Digitalizar** com a câmera ou fotos da galeria, com OCR local.
- Leitor de livros EPUB e de quadrinhos (CBZ/CBR/CB7) com deslizar para virar a página.
- Seis temas, português, inglês e espanhol (idioma do sistema ou escolhido em Configurações), IA pelos mesmos provedores do computador com a chave guardada no Android Keystore.

## Como funciona (para desenvolvedores)

| Camada | Onde | Papel |
|---|---|---|
| Shell nativo | `android/app/src/main/java/br/com/gestaoculturalpro/pdf/` | WebView, arquivos (SAF), processos, impressão, câmera, rede, Keystore |
| Ponte JS ↔ Android | `src/mobile/native.ts` | Chamadas síncronas (envelopes JSON) e pedidos assíncronos com id |
| Adaptadores Node/Electron | `src/mobile/shims/` | `fs`, `path`, `os`, `crypto`, `child_process`, `zlib`, `electron`, `@napi-rs/canvas`, `tesseract.js` |
| Inicialização | `src/mobile/main.tsx`, `bridge.ts`, `shell.tsx` | Roda `src/main/index.ts`, cria `window.gcp` como o preload do desktop e integra Voltar, áreas seguras, "Abrir com" e ações rápidas |
| Interface mobile | `src/renderer/MobileChrome.tsx`, `src/mobile/mobile.css` | Barra superior, menu, pinça; o resto é o `App.tsx` do computador |

Pontos principais:

- **Caminhos**: o dono da interpretação é `FileSystem.kt`. Arquivos do app são caminhos reais; `/android_asset/…` são os recursos do APK; `/saf/<uri>/<nome>` é um documento escolhido pelo usuário; `/safdir/<uri>/<nome>` é um arquivo numa pasta escolhida. Gravações atômicas (`*.gcp-<uuid>.tmp` + rename) usam o cache e só então copiam para o documento.
- **HTML → PDF** (Word, Excel, PowerPoint, texto e XML fiscal): `HtmlPdfRenderer.kt` imprime no Chromium do Android, o mesmo motor do `printToPDF` do Electron. Cabeçalho e rodapé (templates do Chromium) são impressos como sobreposição e carimbados em cada página com pdf-lib. As fontes métricas Carlito/Caladea/Liberation entram no lugar de Calibri/Cambria/Arial/Times/Courier.
- **Rede**: chamadas a provedores de IA e ao GitHub passam pelo cliente HTTP do Android (`fetch` → `NativeBridge.fetch`), como o `fetch` do Node no desktop; o WebView em si não carrega nada de fora.
- **Motor de edição (PdfCraft)**: ver a seção abaixo.

### PdfCraft: o que é e o que não é

O PdfCraft CLI 0.15.0 (MIT OU Apache-2.0) **continua sendo o motor do desktop** e é o mesmo no Android, compilado do código-fonte oficial (`scripts/build-android-engine.sh`, tag v0.15.0, commit `75360d1d`). Ele é usado apenas em: editar texto e imagens originais ("Editar tudo"), marcadores, criação/propriedades/detecção de campos de formulário, importação/exportação de dados de formulário, compressão, proteção com senha, remoção de dados ocultos, marca d'água/cabeçalho e rodapé/recorte/achatamento/tarja, PDF/A, XFA e assinatura/verificação com certificado digital.

**As conversões não usam o PdfCraft**: PDF ↔ Word/Excel/PowerPoint, EPUB, imagens, texto e OCR usam os motores próprios do GCP-PDF sobre PDF.js, pdf-lib, docx, ExcelJS, PptxGenJS, Tesseract e Chromium. O executável vai no APK como `lib/<abi>/libpdfcraft.so` porque o Android só permite executar binários instalados na pasta de bibliotecas nativas do app.

## Compilar

Requisitos: Node e `npm ci` na raiz, JDK 17+, Android SDK 36 com build-tools, e (só para recompilar o motor) Android NDK + Rust com os alvos Android.

```bash
npm run engine:android     # motor PdfCraft para arm64-v8a, armeabi-v7a e x86_64 (uma vez)
npm run build:android      # APK de teste: release/android/GCP-PDF-x.y.z-android-teste.apk
npm run signing:android    # chave de distribuição (uma vez; preserva a existente)
npm run pack:android       # APKs assinados: universal e por arquitetura + SHA256SUMS-Android.txt
```

`scripts/build-android.mjs` gera a camada web (`vite.mobile.config.ts`), copia dicionários, modelos de OCR, fontes e o motor para o projeto Android e chama o Gradle. Variáveis: `JAVA_HOME` (padrão `~/.cache/gcp-pdf-toolchains/jdk-21`), `ANDROID_HOME` (padrão `~/Android/Sdk`), `GCP_ENGINE_DIR` (padrão `~/.cache/gcp-pdf-toolchains/engine-0.15.0`), `GCP_FONTS_DIR` (pasta com Carlito, Caladea e Liberation).

**Chave de assinatura**: `npm run signing:android` cria uma chave RSA 4096 em `~/.cache/gcp-pdf-toolchains/android-signing` e aponta `android/signing.properties` (ignorado pelo Git) para ela. Faça backup privado dessa pasta: atualizações só instalam por cima com a mesma chave. Nunca publique a chave nem o arquivo de senhas.

Para publicar uma versão, anexe os APKs à release do GitHub com os nomes gerados: o verificador de atualizações do app procura `GCP-PDF-x.y.z-android.apk` e abre a página da release para o usuário baixar.

## Depuração

APKs de teste habilitam a depuração do WebView. Com o aparelho ou emulador conectado:

```bash
adb forward tcp:9333 localabstract:$(adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9]+" | tail -1)
```

Depois abra `chrome://inspect` ou use o protocolo DevTools em `localhost:9333`. Em `window.__gcpMobile` ficam o host IPC e os diálogos (para testes automatizados); `globalThis.__gcpEngineTrace = []` registra a conversa com o motor de edição.

## Verificação feita

Em emulador Android 17 (API 37, x86_64, WebView 145), GPU do computador:

- Abrir PDF, Word, Excel e PowerPoint: contagem de páginas e tamanhos idênticos ao pipeline do desktop; diferença visual de 0,1 a 7 % dos pixels por quebras de linha de fontes ausentes no aparelho.
- PDF → Word/PowerPoint: XML do documento idêntico ao do desktop (diferença só nos identificadores de imagens); Excel, texto, PNG, PDF de imagem e EPUB exportados.
- PdfCraft no aparelho: parágrafos, edição de texto original, compressão (5,2 → 2,4 MB), detecção de 83 campos, assinatura A1 de teste verificada pelo `pdfsig` como íntegra.
- OCR local, digitalização pela câmera do emulador, leitores EPUB e de quadrinhos (CBZ, virando com o dedo), assinatura desenhada com o dedo, salvar de volta num arquivo da pasta Downloads, chave de IA no Keystore e erro real dos provedores Gemini/OpenAI com chave inválida.
- Build de distribuição (R8) instalado e aberto; fluxo abrir pelo seletor → Editar tudo.

Também verificados no emulador: pinça e arraste com dois dedos, seleção por toque longo em texto pequeno, edição de texto do PDF pela folha inferior, carimbo de certificado com prévia e assinatura reconhecida (cadeia ICP-Brasil/gov.br embutida), comentários sem balões duplicados, diálogo de impressão do sistema com as páginas do PDF e cores dos seis temas em retrato.

Não verificado ainda: aparelho físico (ARM), Android 8–11 reais, impressão em impressora real, assinatura com certificado A1/A3 real no celular, "Abrir com"/"Compartilhar" vindos de outros apps e chamadas de IA com chave válida.
