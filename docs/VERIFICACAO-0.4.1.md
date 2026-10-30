# Verificação da versão 0.4.1

Validação local em Windows x64, em 30/10/2026. Amostras sintéticas, perfis de teste separados e certificado temporário; nenhum PDF original do usuário foi alterado.

## Anotações e salvamento

- A suíte automática passou com 96 testes aprovados, zero falhas e um teste Unix ignorado no Windows. Typecheck e compilação aprovados.
- PDF.js independente reconheceu os destaques, sublinhados, tachados, tinta, formas padrão e aparências das formas especiais como anotações PDF. Reabertura, exclusão, desfazer/refazer, geometria relativa ao crop box, respostas/popups e preservação de anotações não selecionadas foram verificadas. Um caso adicional confirmou a preservação do catálogo, título, autor, marcadores e campos de formulário ao excluir uma anotação na segunda página.
- O teste real do Electron confirmou: comentário externo leva à segunda página, balão visível, exclusão/desfazer e botão Salvar como criam uma cópia sem modificar o original.
- Notas próprias são exibidas pela camada editável; suas aparências antigas são omitidas apenas na cópia de visualização, preservando os bytes da fonte e evitando ícones remanescentes após excluir.

## Idiomas, OCR, abas e início

- Detecção de variantes de português, inglês e espanhol e fallback PT-BR para idioma desconhecido verificados. Preferência explícita tem prioridade sobre o sistema.
- Troca de idioma pela interface, menus nativos e três amostras de OCR passaram: português com “participação”, inglês com “education” e espanhol com “colaboración”.
- O executável Windows empacotado foi executado com os três modelos locais: todos produziram texto pesquisável a partir de PDFs que continham somente uma imagem.
- Reordenação das abas por arraste, nome completo no tooltip, identificação da aba ativa e alinhamento das bordas do card inicial com Arquivos recentes verificados no Electron real.
- O perfil novo apresentou verificação de atualizações ao iniciar. Preferências existentes não são sobrescritas.

## Criptografia e permissões

- Os PDFs foram gerados pelo fluxo público preload/IPC e pelo motor distribuído com o produto.
- Poppler/pdfinfo verificou 12 cenários: AES-256, AES-128 e RC4-128, cada um com senha de abertura, impressão bloqueada, edição bloqueada ou cópia bloqueada. As permissões não selecionadas permaneceram liberadas conforme cada cenário.
- PDFs com senha de abertura não abriram no Poppler sem a senha e abriram com a senha correta.
- No PDFelement 10 instalado, o PDF com impressão bloqueada mostrou Imprimir desabilitado; o PDF com edição bloqueada e impressão permitida mostrou Imprimir habilitado. O PDF com senha de abertura apresentou o diálogo de senha antes de mostrar o conteúdo.
- O diálogo do GCP só habilita Proteger e salvar quando cada senha selecionada foi preenchida.
- O pacote Windows também passou por edição/salvamento e assinatura RSA com A1 temporário, rejeição de senha incorreta, limpeza da cópia privada e verificação criptográfica após reabrir.

## Limites da verificação

PDFs com destaques já incorporados ao conteúdo da página não contêm uma anotação independente para excluir. A interoperabilidade usa os formatos padrão do PDF; esta validação não representa teste em todos os leitores disponíveis. As permissões de edição/impressão são aplicadas pelo leitor que abre o documento. Não foi usado certificado pessoal A1/A3 ou PIN do usuário.

Os pacotes Linux e macOS são compilados e testados pelo workflow Instaladores Linux e macOS após a publicação da tag; a validação local acima não equivale a teste em hardware Unix.

## Comandos executados

- `npm run typecheck`
- `npm test`
- `npm run build`
- `node scripts/smoke-annotations-security.mjs`
- `node scripts/smoke-language-tabs.mjs`
- `npm run pack:dir`
- `node scripts/smoke-packaged.mjs release/win-unpacked/GCP-PDF.exe windows`
