# Relatorio consolidado de testes

Data: 13 de julho de 2026.

Este relatorio registra os gates executados sobre o mesmo worktree candidato antes
da criacao do artefato de deploy. Credenciais de producao nao foram usadas nos
testes locais.

## Resultado

| Gate                       | Resultado | Evidencia                                                             |
| -------------------------- | --------- | --------------------------------------------------------------------- |
| Dependencias               | Aprovado  | `npm ci --include=dev`; auditoria npm sem vulnerabilidades conhecidas |
| Unitarios/integracao local | Aprovado  | 34 arquivos, 353/353 testes                                           |
| TypeScript                 | Aprovado  | `tsc --noEmit`                                                        |
| ESLint                     | Aprovado  | nenhuma violacao                                                      |
| Build cliente              | Aprovado  | Vite, 63 modulos                                                      |
| Build servidor             | Aprovado  | Vite SSR, 37 modulos                                                  |
| E2E                        | Aprovado  | 104/104 cenarios                                                      |
| Whitespace do patch        | Aprovado  | `git diff --check` sem erro                                           |

## Matriz E2E

O rerun autoritativo foi executado com quatro workers e terminou com codigo zero:

```text
npx playwright test --reporter=line --workers=4
104 passed
```

Os 26 cenarios de `tests/e2e/smoke.spec.ts` passaram em cada projeto configurado:

- Chromium;
- Google Chrome;
- Firefox;
- WebKit.

A matriz cobre rotas publicas e negativas, sete larguras responsivas, guards de
autenticacao, validacao de cadastro, filtro de lojas, CSP, ausencia de codigo inline,
erros de console da pagina e sinais de texto corrompido. Mensagens server-side de
banco ausente nas rotas negativas eram esperadas no ambiente local sem
`DATABASE_URL`; elas nao produziram falha de pagina nem falha de teste.

## Limites deste relatorio

Este documento comprova os gates locais. Backup, migrations, `db:check`, health,
smoke HTTP e validacao visual no dominio de producao pertencem ao registro
operacional do deploy e so podem ser declarados depois da execucao na VPS.
