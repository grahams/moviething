FROM node:20-bullseye-slim

# Install MariaDB client libraries
RUN apt-get update && apt-get install -y \
    libmariadb3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install production dependencies only
RUN npm ci --only=production

# Copy application code
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start", "--workspace=server"]
