
FROM node:20-bookworm-slim

WORKDIR /app

# Instalar Python 3
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Criar ambiente Python isolado
RUN python3 -m venv /opt/utilike-python

ENV PATH="/opt/utilike-python/bin:${PATH}"
ENV CJ_PYTHON_BIN="/opt/utilike-python/bin/python"

# Instalar dependencias Node.js
COPY package*.json ./
RUN npm install --omit=dev

# Copiar arquivos da Uti Like
COPY . .

# Instalar biblioteca de traducao
RUN python -m pip install --no-cache-dir \
    -r robot/requirements.txt

# Instalar modelo ingles-portugues
RUN python robot/instalar_modelo.py

# Configuracao do servidor
ENV NODE_ENV=production

CMD ["node", "server.js"]
