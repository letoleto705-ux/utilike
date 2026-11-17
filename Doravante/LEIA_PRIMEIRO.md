# DORAVANTE — CORREÇÃO DE ESTRUTURA

Esta edição corrige a duplicidade de checkout e remove a página de pagamentos da Loja Tech.

## Arquivos únicos
- `public/checkout-da-sacola.html`: único checkout; **ainda não conectado ao index e ao backend de forma segura**.
- `public/admin_operacoes.html`: inclui relatório de pagamentos de afiliados, consultado nas rotas reais `/api/afiliados` e `/api/rede`, sem simulações nem pagamento Pix automático.
- `public/afiliados.html`: única página de afiliados.
- `public/admin.html`: painel administrativo, com link para operações; várias ferramentas ainda são demonstrações locais.
- `public/index.html`: vitrine; finalização permanece bloqueada enquanto checkout de sacola não estiver integrado.
- `public/cronjob.html`: interface de cronjob e fila de URLs, sem robô de extração completo.

## Limitações e cuidados
- **Não publicar como loja de pagamentos reais.** Checkout multi-itens, persistência integral de produtos e sincronização completa ainda não foram implementados/testados.
- `server.js` continua derivado do legado, não é um backend reconstruído e homologado.
- As migrations 001 e 002 ainda precisam ser verificadas contra o servidor e o Neon novo.
- Não execute `database/REFERENCIA_NAO_EXECUTAR_migration_legada.sql`.
- O relatório financeiro depende do login admin em `index.html` na mesma aba; `sessionStorage` é temporário.
- Nenhuma baixa financeira real deve ser feita sem conciliação e validação.

Esta edição é uma **correção de organização e relatório administrativo**, não uma integração de produção completa.
