# Uti Like — Garimpagem + Cron Job (teste assistido)

1. Faça backup do repositório antes de substituir os arquivos. Publique o conteúdo da pasta Doravante no GitHub/Render, preservando as variáveis existentes. **Não execute SQL novamente:** o endpoint utiliza as tabelas `importacao_urls` e `importacao_lotes` já existentes.
2. No Windows, execute `executar_garimpagem.bat` na pasta do projeto. Abre o painel local `http://localhost:8080` e o Selenium pode abrir o Chrome no próprio PC.
3. No painel local, informe a URL HTTPS do Render e um token JWT de administrador válido. Não cole token em conversa nem envie a terceiros. O token não é gravado em disco.
4. Garimpe URLs normalmente e clique **Enviar URLs do TXT ao Neon**. O script envia lotes de até 1000 e o Neon evita duplicatas por URL.
5. Para imagens: abra a página individual do produto no Chrome do robô, clique **Capturar imagens da página aberta e enviar para revisão**. O script coleta título e URLs de imagens presentes no DOM, sem baixar ou publicar arquivos. Nem toda imagem coletada pertence à galeria; confira os dados.
6. Em `cronjob.html`, clique **Atualizar fila**. Itens capturados ficam `revisao`, e URLs simples ficam `pendente`. O botão de processamento no Render continua tentando apenas metadados públicos de até 3 URLs.

## Limitações importantes
- O Selenium local não pode ser iniciado por uma página hospedada no Render sem um agente local. Use o BAT no Windows.
- A API não possui integração oficial de preços, estoque, frete grátis, origem do envio ou entrega no Brasil. Esses campos ficam **não confirmados**. Não use o preço promocional de primeira compra como preço regular.
- As URLs de imagem são diferentes da URL do produto; imagens `.avif` podem falhar em alguns clientes ou expirar.
- Capturas NÃO publicam automaticamente na vitrine; exigem revisão e fluxo de publicação.
- O endpoint de captura aceita somente URLs diretas AliExpress e exige autenticação de administrador.
- Não execute compras/pagamentos reais sem testes completos.
