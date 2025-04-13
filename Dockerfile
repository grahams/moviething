FROM node:23-bullseye-slim 

# Install MariaDB client libraries and curl for health checks
RUN apt-get update && apt-get install -y \
    libmariadb3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/ ./server/
COPY client/ ./client/

# Install production dependencies only
RUN npm install

# Copy application code
#COPY . .

ENV NODE_ENV=production

# Combined stage that runs both client and server
EXPOSE 3000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1
CMD ["sh", "-c", "npm start"] 
