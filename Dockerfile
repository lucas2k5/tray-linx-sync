# Usa a imagem oficial do Node.js (versão 18 LTS) como base do container
FROM node:18

# Define o diretório de trabalho dentro do container
# Todos os comandos seguintes acontecerão dentro de /app
WORKDIR /app

# Copia os arquivos de dependência (package.json e package-lock.json) para o container
# Isso é feito primeiro para aproveitar o cache do Docker
COPY package*.json ./

# Instala as dependências do projeto com base nos arquivos copiados
RUN npm install

# Copia o restante dos arquivos do projeto para o container
COPY . .

# Expõe a porta 3000, onde o Express estará rodando
EXPOSE 3000

# Comando padrão do container: inicia o servidor Express (index.js)
CMD ["node", "index.js"]
