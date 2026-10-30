# Publicar uma versão do GCP-PDF

A publicação atualiza o código e os instaladores no repositório privado `cliqueprojeto/GCP-PDF`. Quem usa o aplicativo recebe o número da versão e as novidades pelo atualizador.

## Caminho mais simples

1. Abra `NOVIDADES.md` na pasta `gcp-pdf` e escreva uma novidade por linha, começando com `- `. Use frases curtas, explicando o que mudou para quem usa o programa.
2. Dê dois cliques em `Publicar-GCP-PDF.cmd`.
3. Escolha **Correção**, **Melhoria** ou **Grande**. Confira o número e as novidades antes de confirmar.
4. Aguarde os testes, a geração dos dois arquivos e a mensagem final com o endereço da versão publicada.

O atalho usa o Node local quando disponível e, caso contrário, o Node já instalado no computador. Ele não instala ferramentas automaticamente.

## Pelo PowerShell neste computador

```powershell
cd 'C:\caminho\para\gcp-pdf'
.\Publicar-GCP-PDF.cmd
```

No PowerShell, use sempre o atalho `.cmd` ou `npm.cmd` explicitamente. O comando `npm` pode chamar um shim `.ps1` que absorve opções como `--ensaio` e `--sim`. O publicador detecta esse caso e interrompe sem executar nenhuma etapa. Entrada encerrada ou resposta vazia nunca confirmam a publicação.

Para já escolher o tipo:

```powershell
npm.cmd run publicar -- correcao
npm.cmd run publicar -- melhoria
npm.cmd run publicar -- grande
```

**Correção** aumenta o último número, como `0.3.4 → 0.3.5`. **Melhoria** aumenta o número do meio, como `0.3.4 → 0.4.0`. **Grande** inicia uma nova versão principal, como `0.3.4 → 1.0.0`.

## Fazer um ensaio sem publicar

```powershell
.\Publicar-GCP-PDF.cmd correcao --ensaio
```

O ensaio roda os testes e gera os arquivos para conferir a preparação. Ao terminar, restaura **os bytes originais** de `package.json`, dos arquivos de lock, de `assets/novidades.json`, de `HISTORICO.md` e de `NOVIDADES.md`, inclusive alterações locais ainda não salvas no Git. Não cria commit, tag, envio ou release. Os arquivos gerados em `release/` e `dist/` permanecem para inspeção.

## Publicação sem perguntas

Prepare as novidades antes e use explicitamente `--sim`:

```powershell
.\Publicar-GCP-PDF.cmd correcao --sim
```

Também é possível ler um arquivo de novidades separado:

```powershell
npm.cmd run publicar -- correcao --novidades 'docs\novidades-da-versao.md' --sim
```

O arquivo deve conter linhas começando com `- `. Aspas protegem nomes de arquivo que tenham espaços. O script encaminha argumentos diretamente aos executáveis, sem interpretar o conteúdo como comandos de terminal.

`--sem-testes` existe para uma necessidade excepcional, mas não é recomendado: os testes evitam distribuir uma versão com problemas.

## O que é conferido

- A pasta precisa ser a raiz do repositório próprio do GCP-PDF, no ramo `main`, com remoto `origin` apontando exatamente para `cliqueprojeto/GCP-PDF` no GitHub.
- O GitHub precisa estar conectado por `gh auth login`. Esta configuração fica no computador; nenhuma credencial entra no instalador.
- A área de preparação do Git precisa estar vazia. Alterações locais no código podem ser incluídas no commit da versão.
- Antes de uma publicação real, o script baixa as referências e as tags, verifica alterações pendentes do GitHub e recusa números de versão já existentes.
- Typecheck, testes, atualização da versão, geração dos arquivos, preparação, commit, tag, envio e criação da release são conferidos pelo código de saída. Qualquer falha interrompe a sequência.
- Instalador e portátil são obrigatórios. As notas da release incluem o SHA-256 do instalador, verificado pelo atualizador do aplicativo.
- Somente arquivos de código, configuração, documentação pública, licenças e recursos do aplicativo são preparados. `HANDOFF.md`, `.cache/`, `evidence/`, arquivos de credenciais e saídas de compilação ficam de fora. Arquivos previamente preparados no Git não são misturados à publicação.
- `LICENSE` continua sendo a licença proprietária do GCP-PDF; `THIRD_PARTY_NOTICES.md` e as licenças dos componentes de terceiros permanecem incluídos.

## Se ocorrer uma falha

**Antes de criar o commit:** os arquivos de versão e histórico são restaurados byte a byte. As alterações de código que já existiam permanecem na pasta. Confira a mensagem, corrija a causa e tente novamente.

**Depois de criar o commit, a tag ou enviar ao GitHub:** o script **não desfaz a versão, não apaga tags e não reescreve o histórico**. Ele mostra os comandos para continuar exatamente o lançamento interrompido. Não execute uma nova publicação com aumento de versão para tentar repetir a mesma etapa.

Confira primeiro:

```powershell
git status
git log -1
git tag --list v0.3.5
gh release view v0.3.5 --repo cliqueprojeto/GCP-PDF
```

Troque `0.3.5` pela versão mostrada na mensagem de erro. Se o commit e a tag estiverem corretos, mas o envio tiver falhado:

```powershell
git push --atomic origin main v0.3.5
```

Se o código e a tag já estiverem no GitHub e a release ainda não existir:

```powershell
gh release create v0.3.5 `
  release/GCP-PDF-Instalador-0.3.5-x64.exe `
  release/GCP-PDF-Portatil-0.3.5-x64.exe `
  --repo cliqueprojeto/GCP-PDF `
  --verify-tag `
  --title 'GCP-PDF 0.3.5' `
  --notes-file release/novidades.md
```

Se a release existir com um anexo faltando, confira seus anexos no GitHub e envie somente o arquivo ausente com `gh release upload`, indicando a mesma tag e `--repo cliqueprojeto/GCP-PDF`. Não substitua arquivos publicados sem revisar a integridade das notas.


