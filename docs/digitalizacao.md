# Criar e digitalizar PDFs

Na barra superior, entre Abrir e Salvar, **Criar um PDF em branco** permite escolher A4, A3, A5, Carta ou Ofício, orientação e quantidade inicial (1–500 páginas). Use Organizar para acrescentar páginas depois.

O botão **Digitalizar para PDF** abre o assistente local. Escolha o scanner ou a multifuncional, a origem, resolução, cor e papel. A opção OCR está ligada inicialmente e usa o idioma de reconhecimento das Preferências. Nenhuma página é enviada à internet.

Após cada aquisição, revise a prévia, gire, reordene ou remova as páginas. Escolha **Digitalizar mais páginas** para continuar, ou **Finalizar e salvar PDF**. Também é possível inserir após a página atual de um PDF aberto; essa inserção pode ser desfeita. Cancelar a caixa Salvar mantém o documento aberto para salvar depois. Fechar o assistente com páginas pede confirmação de descarte.

## Drivers por sistema

- **Windows x64:** driver compatível com WIA e serviço Aquisição de Imagens do Windows. A opção “Usar interface do scanner” abre as propriedades do item selecionado no driver. Drivers exclusivamente TWAIN não são atendidos por esta integração.
- **Linux x64:** `scanimage` e driver SANE. Debian/Ubuntu: pacote `sane-utils`; Fedora: `sane-backends`; Arch, BigLinux e Manjaro: `sane`. O aplicativo não instala drivers. Instale o pacote pela ferramenta de software da distribuição e, quando necessário, o driver do fabricante.
- **macOS Intel e Apple Silicon:** driver ICA compatível com Image Capture. O auxiliar nativo é compilado para a arquitetura do pacote. Usa a interface do GCP-PDF; não abre uma interface proprietária do fabricante.

As origens exibidas vêm do driver. Duplex automático aparece quando ele o oferece; depende também do alimentador e do equipamento. Sem duplex, digitalize a frente, vire a folha e digitalize o verso, ajustando a ordem na prévia. Windows e Linux adquirem uma folha por vez (duas imagens quando a origem é duplex); o alimentador ICA no macOS pode adquirir todas as folhas carregadas.

O driver pode recusar resolução, modo ou papel incompatíveis. Escolha outra opção; o app não altera esses parâmetros silenciosamente. Na interface WIA, as opções do próprio driver controlam a aquisição; o papel escolhido no GCP-PDF define o tamanho da página PDF.

## Recuperação e limites

Falhas do OCR preservam a imagem e exibem um aviso. Falhas do equipamento depois de produzir páginas preservam as imagens concluídas com o motivo de aquisição parcial. A sessão permite até 100 páginas e 256 MB de PDFs; cada imagem de entrada pode ter até 80 MB e 50 megapixels. Uma aquisição tem prazo de três minutos. Para documentos maiores, finalize um arquivo e comece outro. Não feche o aplicativo antes de salvar: a sessão de digitalização é temporária.

## Verificação da versão 0.11.0

Testes automatizados exercitam a montagem PDF, o OCR local, a prévia, a ordem, a rotação, exclusão, inserção com desfazer, erros parciais e cancelamento. O transporte de aquisição é simulado nesses testes. A enumeração WIA sem equipamento também foi executada no Windows.

**Não houve teste com scanner físico.** Compatibilidade por modelo, interface do fabricante, alimentação, atolamentos e duplex físico precisam de confirmação dos usuários com hardware. Não são recursos certificados para todos os drivers.

## Atualizações

Instalações existentes detectam a nova versão pelo sistema de Atualizações do app, conforme a frequência configurada. O Windows baixa e confere o instalador antes de atualizar. Linux e macOS abrem a release para instalar o pacote correspondente. No Arch/BigLinux/Manjaro, use o novo `.pkg.tar.zst` com Pamac ou `pacman -U`; não há repositório pacman configurado nem publicação no AUR. `pacman -Syu` sozinho não consulta o GitHub.
