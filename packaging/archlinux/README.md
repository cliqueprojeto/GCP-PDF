# Arch Linux, BigLinux e Manjaro

Pacote `gcp-pdf-bin`, x86_64 (Intel/AMD de 64 bits), com o aplicativo oficial da release 0.10.0. Não requer Node.js, npm, Electron ou compilação na máquina de quem instala. As dependências de sistema são resolvidas pelo pacman.

## Instalação mais simples

Na [release 0.10.0](https://github.com/cliqueprojeto/GCP-PDF/releases/tag/v0.10.0), baixe `gcp-pdf-bin-0.10.0-1-x86_64.pkg.tar.zst`. Na pasta do download:

```sh
sudo pacman -U ./gcp-pdf-bin-0.10.0-1-x86_64.pkg.tar.zst
```

No Pamac, quando instalado, também é possível usar **Instalar pacotes locais**, selecionar esse arquivo e confirmar. Depois abra **GCP-PDF** no menu de aplicativos. O pacote registra PDF, EPUB e quadrinhos, com o lançador usando `%F` para receber caminhos de arquivos montados.

Use o sistema atualizado. A validação automatizada roda em Arch Linux; isso não substitui teste direto em cada versão do BigLinux/Manjaro. Se o gerenciador indicar dependências indisponíveis, não force a instalação; o AppImage da mesma release é uma alternativa.

Para conferir integridade, baixe também `SHA256SUMS-ArchLinux.txt` na mesma pasta:

```sh
sha256sum --ignore-missing -c SHA256SUMS-ArchLinux.txt
```

## Atualizar ou remover

O aplicativo continua mostrando novidades em **Configurações → Atualizações**. Para atualizar o pacote, baixe o novo `.pkg.tar.zst` e repita `sudo pacman -U ./nome-do-pacote.pkg.tar.zst`. Não há repositório pacman adicional configurado; `pacman -Syu` sozinho não busca versões deste pacote no GitHub.

Para remover:

```sh
sudo pacman -R gcp-pdf-bin
```

Seus PDFs e preferências pessoais permanecem no computador.

## Receita compatível com AUR

O arquivo `gcp-pdf-bin/PKGBUILD` baixa o DEB oficial da release, confere SHA-256 e reempacota os mesmos binários para pacman. A licença é GPL-3.0-or-later e os avisos dos componentes embarcados são preservados. A receita inclui as permissões do helper de sandbox do Electron, sem acrescentar `--no-sandbox` ao lançador.

Para construir localmente, instale `base-devel` e `git` pelo gerenciador de pacotes e execute como usuário comum:

```sh
git clone https://github.com/cliqueprojeto/GCP-PDF.git
cd GCP-PDF/packaging/archlinux/gcp-pdf-bin
makepkg -si
```

O arquivo `GCP-PDF-aur-recipe.tar.gz` da release contém `PKGBUILD` e `.SRCINFO`, gerado pelo `makepkg`. **A receita ainda não está publicada no catálogo aur.archlinux.org**: isso exige conta e chave SSH de um mantenedor. Portanto, os comandos `yay -S gcp-pdf-bin` e `pamac build gcp-pdf-bin` ainda não estão disponíveis.

## Manutenção e publicação

1. Publique e valide primeiro o DEB da nova versão, com seu digest SHA-256 no GitHub.
2. Execute `node scripts/prepare-arch.mjs X.Y.Z`, confira e commit a receita. O script exige versão numérica e release pública; fixa os hashes do DEB e da licença daquela tag.
3. Execute o workflow **Pacote Arch Linux e receita AUR**, indicando `vX.Y.Z`. Ele verifica a receita commitada, constrói com usuário sem privilégios no contêiner oficial Arch, instala por pacman, verifica dependências/arquivos/atalho/sandbox e executa o smoke completo no aplicativo instalado com Xvfb.
4. Somente depois de todos os testes, o workflow anexa pacote, receita e `SHA256SUMS-ArchLinux.txt` à release existente, sem substituir assets. Evidências ficam no artefato `evidence-archlinux`.

Não é necessário reconstruir os pacotes Windows/macOS para acrescentar esta distribuição do mesmo binário Linux. A primeira distribuição Arch usa `pkgrel=1`; revisões só do empacotamento devem incrementar `pkgrel`.
