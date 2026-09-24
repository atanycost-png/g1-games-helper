# Ficha de publicação — Mozilla Add-ons (AMO)

Preparada em 2026-09-24 para `Logic Games Helper` v4.1.0.

## Resumo

```text
Mostra a solução dos jogos de lógica no Firefox; você conclui cada jogada manualmente, sem preenchimento automático.
```

**Contagem:** 116 caracteres.

## Descrição

```text
O Logic Games Helper é uma extensão assistiva para Firefox. Ela detecta jogos de lógica do portal G1 e mostra a solução diretamente na página, sem digitar, clicar ou enviar jogadas automaticamente. O usuário continua no controle e conclui cada ação manualmente. Suporta Sudoku, Dito, Soletra, Combinado, Labirinto, Caça-Palavras e Palavras Cruzadas. O painel explica a solução, destaca casas, palavras, grupos e trajetos conforme o jogo. A extensão não coleta, armazena nem transmite dados pessoais, não usa servidores externos, não exige serviços pagos e não executa código remoto. Projeto independente, não afiliado ao G1 ou à Globo. Código-fonte e documentação: https://github.com/atanycost-png/g1-games-helper
```

## Opções do formulário

| Campo | Escolha |
|---|---|
| Esta extensão é experimental? | **Não** |
| Requer pagamento/serviço/software/hardware pago? | **Não** |
| Categoria | **Jogos e Entretenimento** |
| Licença | **Licença MIT** |
| Tem política de privacidade? | **Sim** |
| Política de privacidade | `https://github.com/atanycost-png/g1-games-helper/blob/master/PRIVACY.md` |
| Página de suporte | `https://github.com/atanycost-png/g1-games-helper/issues` |
| E-mail de suporte | usar um e-mail controlado pelo proprietário; não inventar nem usar um endereço não monitorado |

## Notas ao revisor

```text
Esta é a variante Firefox assistiva do Logic Games Helper. Ela mostra soluções na página, mas não preenche nem envia jogadas: o usuário conclui cada ação manualmente. O popup oferece somente “Só mostrar”.

A extensão funciona nas páginas de jogos do G1 e suporta Sudoku, Dito, Soletra, Combinado, Labirinto, Caça-Palavras e Palavras Cruzadas. Sudoku.com e o arrasto automático do Labirinto foram removidos desta variante.

A extensão não usa a permissão debugger, não possui background/service worker, não usa <all_urls>, não carrega código remoto, não usa eval/new Function e não coleta nem transmite dados pessoais. Os puzzles são lidos dos dados que o próprio site entrega ao navegador.

O código é legível e não minificado. A fonte está disponível em:
https://github.com/atanycost-png/g1-games-helper

Build reproduzível a partir do repositório:
1. git clone https://github.com/atanycost-png/g1-games-helper
2. cd g1-games-helper
3. python -m venv .venv
4. .venv/Scripts/python.exe -m pip install Pillow
5. .venv/Scripts/python.exe tools/build_amo_assets.py
6. .venv/Scripts/python.exe tools/build_firefox.py

O pacote gerado fica em dist/logic-games-helper-firefox.zip. O Manifest inclui data_collection_permissions com required: [none]. O lint oficial web-ext foi executado com 0 erros, 0 notices e 0 warnings.

A extensão é um projeto independente e não é afiliada, patrocinada ou endossada pelo G1 ou pela Globo.
```

## Assets

```text
assets/amo/final/dito.png
assets/amo/final/labirinto.png
assets/amo/final/cruzadas.png
```

As três imagens têm 1280×800 e foram compostas a partir de capturas reais do
modo assistido executado no Firefox. Ícones finais: `extension/icons/icon16.png`,
`icon48.png` e `icon128.png`.
