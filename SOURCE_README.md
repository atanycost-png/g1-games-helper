# Código-fonte — Logic Games Helper Firefox v4.1.0

Este arquivo contém as instruções para reproduzir exatamente o pacote Firefox
assistivo enviado ao Mozilla Add-ons.

## Requisitos

- Windows 10/11 ou sistema compatível com Python;
- Python **3.11 ou superior**;
- `pip` habilitado;
- Pillow **10 ou superior**;
- nenhum Node.js, npm, servidor local, API key ou serviço externo é necessário
  para gerar a extensão.

O `web-ext` é opcional e serve apenas para validar o pacote antes do upload.

## Estrutura relevante

```text
extension/                  fonte única dos módulos da extensão
assets/amo/source/          screenshots reais usadas na composição dos assets
tools/build_amo_assets.py   gera ícones e screenshots promocionais
tools/build_store.py        gera a base sem debugger
tools/build_firefox.py      gera a variante Firefox assistiva
tools/build_amo.py          executa o pipeline completo
dist/                       artefatos gerados; não é fonte
```

## Build reproduzível no Windows

Abra o terminal na raiz do repositório e execute:

```text
py -3.11 -m venv .venv
.venv\\Scripts\\python.exe -m pip install --upgrade pip
.venv\\Scripts\\python.exe -m pip install "Pillow>=10,<13"
.venv\\Scripts\\python.exe tools\\build_amo.py
```

O script executa, nesta ordem:

1. `tools/build_amo_assets.py` — gera os ícones 16/48/128 e as três screenshots
   1280×800 a partir das capturas reais em `assets/amo/source/`;
2. `tools/build_store.py` — valida e gera a base sem `debugger`, Sudoku.com,
   `background.js` e `<all_urls>`;
3. `tools/build_firefox.py` — copia a base, remove o modo automático do popup,
   força o modo assistido, adiciona `browser_specific_settings.gecko` e gera
   o pacote Firefox.

Os artefatos finais são:

```text
dist/firefox/
dist/logic-games-helper-firefox.zip
```

O ZIP final deve ser byte-a-byte reproduzível para o mesmo ambiente/versão das
dependências, salvo metadados de timestamp do arquivo ZIP.

## Validação opcional

Para validar o Manifest com a ferramenta oficial Mozilla:

```text
npm install --global web-ext
web-ext lint --source-dir dist/firefox
```

O pacote v4.1.0 foi validado com:

```text
errors:   0
notices:  0
warnings: 0
```

## Escopo da variante Firefox

Esta variante é **assistiva-only**:

- mostra soluções na página;
- não preenche nem submete jogadas;
- não usa `debugger`;
- não possui service worker/background;
- não usa `<all_urls>`;
- não usa Sudoku.com;
- declara `data_collection_permissions: {required: [none]}`.

A fonte contém também a variante completa para uso pessoal/GitHub. O build
Firefox remove conscientemente esses caminhos antes de criar o ZIP submetido ao
AMO. A fonte original não é minificada, transpilada ou concatenada.

## Testes

O smoke test Firefox usa Selenium e requer uma instalação local do Firefox:

```text
.venv\\Scripts\\python.exe -m pip install selenium
.venv\\Scripts\\python.exe tools\\test_firefox_assistido.py
```

O teste instala o ZIP temporariamente, valida o popup no motor Gecko e executa
o modo assistido nos sete jogos de teste. O resultado esperado é `7/7`.

Código-fonte e histórico:

```text
https://github.com/atanycost-png/g1-games-helper
```

Licença: MIT.
