FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy remaining files
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
