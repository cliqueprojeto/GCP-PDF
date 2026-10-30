# GCP-PDF

**Leitor e editor de PDF completo, em português, que funciona no seu computador.**

O GCP-PDF reúne num só programa o que normalmente exige vários: ler, comentar, editar o texto e as imagens originais, organizar páginas, preencher e criar formulários, assinar com certificado digital ICP-Brasil, proteger e converter documentos. Tudo em português do Brasil, sem cadastro e com seus arquivos sempre no seu computador.

Desenvolvido por **Bruno Albertini | [Gestão Cultural Pro](https://gestaoculturalpro.com.br/)**.

## Baixar

Baixe a versão mais recente na página de [versões publicadas](https://github.com/cliqueprojeto/GCP-PDF/releases/latest):

- **GCP-PDF-Instalador-x.y.z-x64.exe** — instala no Windows 10 e 11 (64 bits), cria atalhos e adiciona as ações no menu do botão direito do Explorador de Arquivos.
- **GCP-PDF-Portatil-x.y.z-x64.exe** — roda sem instalar, por exemplo a partir de um pendrive.

Como o instalador ainda não tem assinatura digital de código, o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.

O programa avisa quando houver uma versão nova e se atualiza sozinho, com a frequência que você escolher em **Configurações › Atualizações** (ou nunca). Cada instalador baixado é conferido pela assinatura SHA-256 publicada junto com a versão.

## O que ele faz

### Ler
- Leitura contínua, em página única ou duas páginas lado a lado, com zoom, tela cheia e filtro noturno.
- Volta para a página e a posição onde você parou em cada arquivo.
- Página inicial com arquivos recentes, busca e documentos abertos em abas.
- Pesquisa no documento, marcadores (criados à mão ou a partir dos títulos) e miniaturas das páginas.

### Comentar e revisar
- Comentários em balões, destaque, sublinhado e tachado de texto.
- Caixas de texto, carimbos, formas, desenho à mão livre e medidas de distância, perímetro e área em centímetros.
- Comparação de dois PDFs, mostrando o que entrou, saiu ou mudou.

### Editar
- Edição do texto original da página, mantendo fonte, tamanho e cor.
- Imagens originais do PDF: mover, redimensionar, girar, espelhar, substituir, recortar, ajustar cores e salvar como arquivo.
- Inserção de texto, imagens e páginas em branco.

### Organizar
- Girar, excluir, extrair, copiar, colar e reordenar páginas arrastando as miniaturas.
- Combinar vários arquivos em um PDF e dividir um documento em partes.
- Numeração de páginas e numeração Bates.

### Formulários
- Preenchimento de formulários PDF, com máscaras automáticas para CPF, CNPJ, CEP, telefone, data e valores em reais.
- Criação de campos: texto, data, caixa de seleção, opções, lista suspensa, caixa de lista, imagem, assinatura e botões com ações (abrir link, ir para página, limpar e imprimir).
- Reconhecimento automático de formulários e exportação dos dados em CSV.

### Assinar e proteger
- Assinatura digital com certificado ICP-Brasil (A1 em arquivo ou A3 em token/cartão), com prévia da posição na página. Arquivos assinados no programa aparecem como válidos no [Validador do ITI](https://validar.iti.gov.br/).
- Verificação das assinaturas digitais de um documento, usando a cadeia de certificados confiáveis do Windows.
- Proteção com senha, remoção de dados ocultos e edição das propriedades do documento.
- Um PDF assinado nunca é sobrescrito por engano: alterações são salvas como cópia.

### Converter
- Exportar para Word, Excel, PowerPoint e PDF de imagens.
- Converter arquivos para PDF e criar um PDF novo em branco.
- Reconhecimento de texto (OCR) em português, feito no próprio computador.
- Compressão de PDF em vários níveis, com prévia do tamanho final.

## Privacidade

Os documentos são abertos, editados e salvos localmente. O GCP-PDF não exige conta e não envia seus arquivos para servidores. A conexão com a internet só é usada para verificar atualizações no GitHub, abrir links que você escolher e recursos opcionais que você mesmo configurar.

## Para desenvolvedores

O GCP-PDF é feito com Electron, React, TypeScript, PDF.js e pdf-lib. O motor de edição do conteúdo original das páginas é baseado no [PdfCraft](assets/pdfcraft/NOTICE).

Requisitos: Windows 10/11, Node.js 24 e npm.

```powershell
npm.cmd ci           # instala as dependências travadas
npm.cmd run dev      # abre o programa em modo de desenvolvimento
npm.cmd test         # roda os testes automatizados
npm.cmd run pack:win # gera o instalador e a versão portátil em release/
```

Como publicar uma versão nova está explicado em [docs/PUBLICAR.md](docs/PUBLICAR.md). O histórico de mudanças fica em [HISTORICO.md](HISTORICO.md).

Sugestões e problemas podem ser enviados na aba [Issues](https://github.com/cliqueprojeto/GCP-PDF/issues).

## Licença

Copyright © 2026 Bruno Albertini | Gestão Cultural Pro.

O GCP-PDF é software livre: você pode redistribuí-lo e modificá-lo sob os termos da **GNU General Public License, versão 3 ou posterior**, publicada pela Free Software Foundation. Ele é distribuído na esperança de ser útil, mas **sem nenhuma garantia**. Veja o arquivo [LICENSE](LICENSE).

Os componentes de terceiros (motor de edição, fontes, modelo de OCR e bibliotecas) mantêm suas próprias licenças, listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
