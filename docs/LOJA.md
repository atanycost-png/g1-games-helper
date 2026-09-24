# Checklist de lançamento em lojas (Chrome Web Store / Edge Add-ons)

Auditado em **2026-09-24** sobre a **v4.1.0** (a auditoria anterior, de 2026-09-23,
era da v4.0.0 e não conhecia o modo assistido). Cada linha tem evidência.

## Resposta curta

**Não, o `chrome.debugger` não é o único impedimento.** É o maior item *técnico*,
mas há mais quatro, e um deles é o mais rápido de virar remoção: a **marca no nome**.
Existe ainda um bloqueador que **não desaparece** removendo o `debugger`: a política
de interferência em serviços de terceiros.

## Os cinco, em ordem de risco real

| # | Item | Evidência / por quê |
|---|---|---|
| 1 | **Marca "G1" no nome e na descrição** | Política *Impersonation & Intellectual Property*: "Don't infringe on the intellectual property rights of others, including patent, **trademark**, trade secret, copyright…". O takedown vem por reclamação do titular e **não depende do nosso código** — é o caminho mais curto para sair do ar. |
| 2 | **Permissão `debugger`** | Política *Use of Permissions*: "Request access to the **narrowest permissions** necessary… Don't attempt to *future proof* your Product by requesting a permission…". Além da revisão manual, o usuário vê a faixa **"«extensão» started debugging this browser"** (Chromium issue 40136122). |
| 3 | **`<all_urls>`** | Mesma política de permissões: padrão de host amplo é *broad host permission* → revisão estendida e justificativa obrigatória. |
| 4 | **Interferência / automação de jogo** | Política *Malicious and Prohibited Products*: "We don't allow content that harms or **interferes with the operation** of the networks, servers, or other infrastructure of Google or **any third-parties**". Vale mesmo sem `debugger` — o modo automático continua automatizando o jogo. Risco de política, não de código. |
| 5 | **Assets e ficha da loja** | Não existem: faltam 1–5 screenshots (1280×800 ou 640×400), tile 440×280, ícone que venda, o formulário de práticas de dados e o campo *single purpose* preenchido com detalhe ("Include detailed information in the single purpose field regarding your extension's primary functionality"). |

## Modo humano: conformidade e limites

**Sim, o modo humano está implementado nos caminhos automáticos**, no sentido
correto de cadência de interação: o modo Humano usa pausas aleatórias, entrada
letra a letra, ordem gradual, pausas maiores em blocos e — no CDP — movimento do
mouse interpolado. Normal acelera essa cadência; Rápido reduz para atraso mínimo.

Isso é **UX/ritmo humanizado**, não é garantia de comportamento indistinguível de
uma pessoa, não é mecanismo de evasão de detecção e não muda a avaliação de
política da loja. Para a ficha, a descrição correta é "ritmo configurável" ou
"pausas entre ações"; nunca "indetectável".

No modo **Só mostrar**, a extensão não preenche nem submete nada: pinta a solução
e o próprio usuário realiza os gestos. Os sete jogos foram verificados com
`tools/test_assistido_cdp.py`: solução visível e estado do jogo inalterado.

O comportamento está coberto por código real:

| Caminho | Evidência do modo Humano |
|---|---|
| Sudoku G1 | atraso variável entre células + pausa maior em blocos |
| Dito/Soletra | letra a letra + pausa antes da confirmação |
| Combinado/Cruzadas | ordem gradual + pausas entre grupos/palavras |
| Caça-Palavras | um destaque por vez, com intervalo |
| Labirinto CDP | mouse interpolado e pontos intermediários |
| Sudoku.com CDP | mouse interpolado, cliques e pausas entre célula/numpad |
| Só mostrar | usuário faz a interação; não há automação |

O modo Humano **não elimina** o risco de política sobre automação de jogos de
terceiros. Remover `debugger` diminui a superfície técnica e visual, mas não
transforma o modo automático em automaticamente aceitável para a CWS/Edge.

## O que o modo assistido mudou (v4.1.0)

O modo assistido (`extension/revelar.js`) é **100% DOM** — verificado: **zero**
referências a CDP/`chrome.debugger` no arquivo. Hoje quem depende de `debugger` são
exatamente **dois** caminhos:

- `cdpSudoku` (`popup.js`) → Sudoku.com, cujo tabuleiro é canvas sem DOM de casas;
- o **arrasto** do Labirinto (`labirinto.js` devolve `precisaCdp` → background executa `Input.dispatchMouseEvent`).

Ou seja: um build de loja sem `debugger` **perde muito menos do que perdia antes**.

| Recurso | Hoje (com `debugger`) | Build de loja |
|---|---|---|
| Sudoku (G1) | resolve ou mostra | **os dois modos, intactos** |
| Dito, Soletra, Combinado, Caça-Palavras, Cruzadas | resolve ou mostra | **os dois modos, intactos** |
| Labirinto | traça o caminho sozinho | **modo assistido**: trajeto desenhado sobre o canvas, quem traça é você |
| Sudoku.com | resolve | **sai do pacote** (outro site; sem input real não há preenchimento nem assistido) |
| Permissões | `activeTab`, `scripting`, `storage`, `debugger` | `activeTab`, `scripting`, `storage` |
| `background.js` | executor CDP | sai — a extensão vira **content script + popup** (o cenário mais limpo para revisão) |
| Hosts | `<all_urls>` | `https://g1.globo.com/*` |

## ✅ O que já está conforme (não precisa mexer)

| Item | Evidência |
|---|---|
| Manifest V3 | `manifest_version: 3` |
| Sem código remoto | 0 `eval(`/`new Function(`; nenhum CDN |
| Sem script inline (CSP do MV3) | `popup.html` só usa `<script src="popup.js">`; 0 `onclick=` |
| Ícones 16/48/128 | PNGs válidos |
| `version` semântica | `4.1.0` |
| `name` dentro do limite | 15 chars (limite 75) |
| `description` dentro do limite | **114 chars** (limite 132) |
| Permissões todas em uso | `activeTab`, `scripting`, `storage`, `debugger` |
| Sem permissão morta | `tabs` saiu (o código nunca lê `tab.url`) |
| Política de privacidade | [`PRIVACY.md`](../PRIVACY.md) |
| Sem coleta de dados | nada sai do navegador; requisições só para a origem do jogo |

## Caminhos

### A) Só GitHub (é o que está no ar hoje)

Zero risco de loja, instalação por *Load unpacked*.
<https://github.com/atanycost-png/g1-games-helper>

### B) Build de loja (perde 1 jogo e 1 gesto, ganha submetibilidade)

#### Manutenção sem duplicar código

Não existe uma segunda cópia editável. `extension/` é a **fonte única**; o
script `tools/build_store.py` gera o pacote de loja em `dist/store/` e o ZIP
`dist/g1-games-helper-store.zip`.

```bash
python tools/build_store.py --check  # falha se entrar debugger, <all_urls>, etc.
python tools/build_store.py           # gera diretório + ZIP
# ou:
# npm run check:store && npm run build:store
```

Os trechos exclusivos da variante completa são marcados na fonte com
`/* @loja:remove:start */` e `/* @loja:remove:end */`. O gerador remove esses
blocos, reconstrói o `manifest.json` sem `debugger`/background e restringe o host
a `https://g1.globo.com/*`. Se uma futura alteração reintroduzir um caminho
privilegiado sem estar contemplada no gerador, o build **falha** em vez de
produzir silenciosamente um pacote incoerente. `dist/` é descartado pelo Git;
o ZIP é o artefato para upload.

1. **Tirar `debugger`** do manifest → sai o Sudoku.com; o Labirinto fica no modo
   assistido (o trajeto continua sendo calculado e desenhado no canvas).
2. **Restringir hosts** para `https://g1.globo.com/*` (sem `<all_urls>`).
3. **Remover `background.js`** e o `service_worker` do manifest.
4. **Renomear** sem marca — ex.: *Logic Games Helper*, *Word & Logic Puzzle Helper*.
5. **Assets**: 3 screenshots 1280×800, tile 440×280, ícone redesenhado.
6. Preencher a ficha: categoria *Fun/Ferramentas*, pt-BR, link da política de
   privacidade, práticas de dados ("nenhum dado coletado") e o *single purpose*.

> O item 4 da tabela de risco (interferência) **não desaparece** neste caminho.
> Mesmo enxuto, é uma extensão que resolve jogos por você. Distribuição de risco
> baixo e reversível — não é garantia de aprovação. Publicar **primeiro no Edge
> Add-ons** (bem mais permissivo) e só depois avaliar a CWS.

### C) Greasy Fork (userscript) — **a rota de menor atrito**

As regras são objetivas e o validador é o próprio build
(`python tools/build_userscript.py` falha se alguma quebrar):

| Item | Situação |
|---|---|
| Código legível (sem ofuscação/minificação) | ✓ 140 KB, 3.458 linhas |
| `@license` | ✓ MIT |
| `@match` restrito | ✓ só `https://g1.globo.com/jogos/*` |
| `eval` / `new Function` / CDN | ✓ ausentes |
| Tamanho | ✓ 140 KB (limite 2 MB) |
| Descrição batendo com o escopo | ✓ Sudoku.com **fora** |
| `debugger` / hosts amplos / assets | ✓ não existem em userscript |

Continua valendo a marca no nome (renomear é mais seguro). **Como publicar** (3
passos, precisa da conta): criar conta em <https://greasyfork.org>, *Add script*
colando `userscript/g1-games-helper.user.js` (ou apontando a URL raw do GitHub),
publicar.

## Checklist operacional antes do upload

- [x] `npm run check:store`
- [x] `npm run build:store`
- [x] `node --check` nos JavaScript da variante
- [x] invariantes: sem `debugger`, Sudoku.com, `<all_urls>`, background e marcadores
- [x] smoke test do popup completo e do popup da loja
- [ ] screenshots da loja
- [ ] tile promocional e ícone final
- [ ] ficha de práticas de dados e *single purpose*
- [ ] submissão/revisão no Edge Add-ons
- [ ] eventual submissão/revisão na Chrome Web Store

## Mozilla Add-ons (AMO): custo e situação

Verificado em 2026-09-24 na documentação oficial da Mozilla: **não há taxa de
publicação nem cobrança de cadastro indicada para o AMO**. A conta de
 desenvolvedor é integrada a uma conta Mozilla; a documentação oficial descreve
login, nome público, submissão e revisão, sem etapa de pagamento.

Fontes oficiais:

- [Developer accounts](https://extensionworkshop.com/documentation/publish/developer-accounts/)
- [Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)

Isso não significa publicação automática: ainda existe revisão, assinatura da
extensão e exigência de cumprir as políticas. A conta não deve usar e-mail
descartável, e a Mozilla pode bloquear contas que enviem repetidamente add-ons
em violação das políticas.

Para o nosso projeto, o pacote de loja sem `debugger` é um bom ponto de partida,
mas ainda precisa de uma variante Firefox testada. O Manifest V3 e a API
`chrome.*` podem exigir compatibilidade/ajuste para `browser.*`; principalmente,
o `chrome.debugger` fica fora da variante sem privilégios, então o Sudoku.com e
o arrasto automático do Labirinto continuam excluídos. A rota de menor risco é
publicar primeiro o **userscript no Greasy Fork**; AMO é uma alternativa sem taxa,
mas continua exigindo revisão e não elimina o risco de política sobre automação.

## Recomendação

| Objetivo | Caminho |
|---|---|
| Compartilhar com amigos hoje, sem exposição | **A** (GitHub) |
| Publicar "de verdade" com o mínimo de atrito | **C** (Greasy Fork) |
| Estar na loja de extensões | **B**, e Edge Add-ons antes da CWS |
