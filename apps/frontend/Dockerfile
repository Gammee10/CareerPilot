FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

RUN npm run build

USER node
EXPOSE 3000

CMD ["npm", "run", "start"]
