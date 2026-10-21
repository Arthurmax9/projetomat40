FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8787 DB_FILE=/data/matematica40.db UPLOAD_DIR=/data/uploads COOKIE_SECURE=true
VOLUME /data
EXPOSE 8787
CMD ["node", "src/node.js"]
