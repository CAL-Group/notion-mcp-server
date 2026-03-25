FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Pre-install notion-mcp-server globally so supergateway doesn't npx-download it per request
RUN npm install -g @notionhq/notion-mcp-server

# Copy remaining files
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
