# Agendamento Beatriz Lima (Lash Designer) — contexto da sessão

> Arquivo de retomada. Foi escrito no fim de uma sessão longa para que, ao voltar, eu (Claude) saiba onde paramos.
> O Claude Code lê este arquivo sozinho quando é aberto nesta pasta. Atualize-o ao fim de cada sessão.

## Quem é o usuário e como trabalhar com ele
- Fala português (BR). Responder sempre em português, direto e sem enrolação.
- Dono do projeto: conta GitHub `Pollaar`, e-mail cayquereis5@gmail.com. A cliente final é a **Beatriz Lima**, lash designer (cílios e sobrancelhas).
- Costuma mandar **imagens** (prints, fotos, referências de design) e pedir ajustes visuais finos. Sempre conferir o resultado no navegador antes de dizer que está pronto.
- Pede "abra o teste" / "abra o testelocal" = abrir http://localhost:3000 (subir o servidor se não estiver rodando).
- Só fazer **commit e push quando ele pedir**. Costuma dizer "faça o commit e push" depois de aprovar.

## O que é o projeto
Site de agendamento + painel da dona. Node/Express, sem build. Pasta local: `C:\Users\patri\Downloads\agendamento-cilios`.
- Site da cliente: `/` (`public/index.html`, tudo em um arquivo, JS puro).
- Painel da dona: `/admin` (`public/admin.html`, PWA com push). Senha = variável `ADMIN_KEY` (local sem `.env` usa o padrão do código; no Render é a que foi preenchida lá). **Não anotar a senha aqui.**
- Fluxo: dona libera semanas/horários → cliente pede (status `pending`, não ocupa vaga) → dona **Confirma** (ocupa vaga, abre WhatsApp da cliente) ou **Recusa**.
- Dados: `data/*.json` local; Upstash Redis no Render (`store.js`). `data/` e `.env` não vão para o GitHub.
- Catálogo, textos, preços, fotos, Instagram, WhatsApp e dados do Pix ficam em **`catalog.json`** (relido sozinho).
- README.md já explica instalação, deploy (Render + Upstash + cron-job.org), API e uso do painel. **Está desatualizado** quanto a: forma de pagamento, mensagem do sinal, campos `zoom`/`origin` das fotos, `scripts/og.js`, botões de Instagram/WhatsApp.

## Publicação
- Repositório: https://github.com/Pollaar/biadesign (branch `main`). O Render publica sozinho a cada push. Site: https://studio-beatrizlima-9n9u.onrender.com
- **A pasta do projeto NÃO é um repositório git.** O git (instalado em `C:\Program Files\Git\cmd`, fora do PATH da sessão) é usado num clone separado:
  `C:\Users\patri\AppData\Local\Temp\claude\C--Users-patri\b61fe781-9d84-47b3-8e1f-abf0ab75ee09\scratchpad\biadesign`
- Rotina de deploy usada (PowerShell): `$env:Path += ';C:\Program Files\Git\cmd'`; ir ao clone; `robocopy <projeto> . /E /XD node_modules data .git /XF .env .env.example`; remover do clone as miniaturas de `public/img/thumbs` que não existem mais no projeto; `git config core.autocrlf true`; `git add -A`; commit com `-c user.name="Pollaar" -c user.email="cayquereis5@gmail.com"`; `git push origin main`.
- O login do GitHub ficou salvo (Git Credential Manager); os pushes recentes passaram sem pedir senha. Se pedir, o usuário precisa logar fora do Claude Code (a sessão não abre janela de login).
- Último commit enviado: `15315f5` "Dinheiro como forma de pagamento". Histórico recente: `559681c` botões Instagram/WhatsApp lado a lado no celular; `6c6291b` pagamento + mensagem do sinal + botões; `7413b70` prévia do link (Open Graph); `15ab1ee`/`b5fcb9e` fotos novas.
- `.env.example` (no repositório) contém uma ADMIN_KEY e o telefone da dona. Foi avisado que, se aquela senha está em uso, deve ser trocada no Render. Não mexi nele.

## Estado atual do site (tudo isso já está no GitHub)
**Topo (hero)**
- Título "BEATRIZ **B** LIMA": SVG inline com o B grande e uma **linha cursiva em volta (agulha + fio, um "L" cursivo)**, em gradiente rosa; onde a linha cruza o B ela fica branca (clipPath). Referência do usuário: logo branco sobre degradê rosa/vermelho, só reproduzimos o formato da linha, mantendo as cores do site.
- Centralização: no desktop é grid `1fr auto 1fr` (B no centro exato); no celular (≤600px) vira flex: B grande em cima e "BEATRIZ LIMA" embaixo. Estrelinhas escondidas no celular.
- Slogan "LASH DESIGNER" maior e em negrito, mais perto do logo.
- Botões **Instagram** (@lash.beatrizlima) e **WhatsApp** ((21) 96519-3674, abre conversa com texto pronto) logo abaixo de "Agendar horário"; lado a lado também no celular. Também aparecem como etiquetas em "Sobre" e no rodapé.

**Catálogo**
- Fotos preenchem o card (object-fit cover) com ponto de foco por foto (`focus` = object-position) para o olho ficar centralizado. Campos opcionais `zoom` + `origin` (ex.: Volume Egípcio foto 1: `zoom 1.45`, `origin "0% 64%"`). `scripts/thumbs.js` entende os mesmos campos.
- Setas ‹ › nos cards com mais de uma foto (aparecem só com mouse; no celular arrasta).
- Fotos atuais: Volume Brasileiro (2), Volume Egípcio (2: `volume-egipcio-5`, `-6`), Volume Brasileiro Marrom (2: `-3`, `-4`), Volume Fox Eyes (2: `fox-eyes-1`, `fox-eyes-4`), Design com Henna (2: `design-henna-2`, `-3`), Design Simples (1). Arquivos de fotos antigas continuam em `public/img/` (não apagamos, só as miniaturas). `fox-eyes-3.jpg` foi **espelhado** e não está mais em uso.
- Depois de mexer em fotos/focus/zoom: `npm run thumbs`. Antes de enviar, apagar do clone as miniaturas obsoletas.
- Antes e depois (seção Sobre): quadro 9:16, fotos inteiras.

**Agendamento (4 passos)**
- Passo 1: serviço → Aplicação/Manutenção → adicionais → **Forma de pagamento (obrigatória, nada vem marcado): Pix, Cartão (aproximação) ou Dinheiro**.
- Servidor (`server.js`) valida `payment` (`pix`|`cartao`|`dinheiro`), grava no pedido, e inclui no WhatsApp cliente→dona, no push para a dona e no painel (💠/💳/💵). Pedidos antigos sem pagamento continuam funcionando.

**Mensagem quando a dona clica em Confirmar** (igual ao modelo do usuário; vale para as 3 formas de pagamento):
```
Para confirmar o seu horário eu peço um sinal de R$20,00 o valor será abatido no dia do procedimento 🥰

Pix 👇🏽
Beatriz Lima Santos
Banco Nubank
Telefone
*21965193674*

Leia com atenção

✨O horário será confirmado somente após o sinal.
✨Em caso de desistência o valor não será devolvido.
✨Em caso de imprevistos avisar com 24h de antecedência.
```
Dados em `catalog.json › business.deposit` (amount, pixName, bank, pixKeyType, pixKey). O texto existe em dois lugares que precisam ficar iguais: `clientMessage()` em `server.js` e `waText()` em `public/admin.html`. Recusa e cancelamento mantêm as mensagens antigas.

**Prévia do link (WhatsApp)**: tags Open Graph no `<head>` do `index.html` + imagem `public/img/og.jpg` (1200x630, gerada por `node scripts/og.js`). O endereço do Render está fixo nas tags `og:url`/`og:image`; se o domínio mudar, atualizar. O WhatsApp guarda cache: testar com `/?v=2` no fim do link.

## Pendências e ideias (nada disso foi pedido ainda)
1. **Etapa "aguardando sinal":** a mensagem diz que o horário só é confirmado após o sinal, mas o botão Confirmar do painel já marca `confirmed` e tira a vaga. Foi oferecido criar um status intermediário. Sem resposta do usuário.
2. Perguntado e sem resposta: se o sinal é igual para quem paga em cartão/dinheiro.
3. Perguntado e sem resposta: trocar também o "B" do menu superior e dos ícones do app do painel (hoje continuam B; o título grande também voltou a ser B).
4. Visual do título: o usuário não confirmou se quer o fundo degradê rosa/vermelho com letras brancas como na imagem de referência.
5. Atualizar o README com as novidades listadas acima.
6. Revisar o `.env.example` público (senha e telefone reais).
7. Testar no celular real o título, os botões sociais e o carrossel (só foi testado simulando larguras de 320 a 390 px).
8. Em uma ocasião, um clique real do mouse na seta do carrossel levou a página ao topo (por script não reproduziu). Pedi ao usuário que avisasse se acontecer.
9. iPhone: notificação push só funciona com o painel instalado na Tela de Início (iOS 16.4+) via Safari; o Chrome não ajuda.

## Como rodar e testar
- `npm start` (porta 3000). Local sem `.env` usa dados de `data/` e senha padrão do código.
- A agenda local tem datas já passadas; para testar um pedido completo é preciso liberar uma semana futura em `/admin`, ou usar uma cópia isolada (foi feito assim para testar a mensagem de confirmação).
- Para ver o celular sem celular: página temporária com `<iframe width=360>` servida de `public/_m.html` (apagar depois).
- Ferramentas úteis nesta máquina: Chrome via extensão (screenshot e javascript_tool), mas o redimensionamento de janela não funcionou.
- Cuidado: nesta máquina o PATH da sessão não tem `git`; em PowerShell usar `& "caminho"` para executáveis com aspas e evitar `\n` dentro de strings de substituição (já quebrou o `admin.html` uma vez).
