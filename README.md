# Wly Nvmrc - Node Version Guard

Evita a "sopa de versões" de Node ao trocar entre projetos (Node puro, Angular/AngularJS, Salesforce LWC/Aura etc).

## O que faz

1. Detecta se o workspace é um projeto Node (`package.json`, `node_modules` ou `.nvmrc`).
2. Se for, procura um `.nvmrc` na raiz:
   - **Existe e a versão bate** com o Node ativo → status bar mostra `✓ Node vX.X.X`.
   - **Existe e diverge** → status bar mostra alerta e permite trocar a versão via `nvm use`/`nvm install` direto pelo menu.
   - **Não existe** → status bar avisa que falta o `.nvmrc` e oferece criar um com a versão atual do Node.
3. Tudo também aparece na view lateral (ícone na Activity Bar) com as mesmas ações.

## Requisitos

- [nvm-windows](https://github.com/coreybutler/nvm-windows) instalado e no PATH para usar as ações "nvm use" / "nvm install". Sem o nvm, a extensão ainda detecta e sinaliza divergências, só não troca a versão automaticamente.

## Configurações

- `wlyNvmrc.notifyOnMismatch` (padrão `true`): mostra um toast quando detecta divergência de versão.
- `wlyNvmrc.pollIntervalSeconds` (padrão `15`): intervalo para reavaliar a versão ativa do Node enquanto a janela está em foco (`0` desativa o polling; a checagem por foco e por mudança do `.nvmrc` continua ativa).

## Desenvolvimento

```
npm install
npm run watch:esbuild
```

Pressione `F5` no VS Code para abrir uma janela de Extension Development Host.
