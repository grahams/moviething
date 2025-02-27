FROM node:20-slim AS builder
LABEL org.opencontainers.image.source="https://github.com/grahams/moviething"

WORKDIR /app

# Install build dependencies for MariaDB
RUN apt-get update && apt-get install -y \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install MariaDB Connector/C
RUN wget https://dlm.mariadb.com/2862620/Connectors/c/connector-c-3.3.7/mariadb-connector-c-3.3.7-debian-buster-amd64.tar.gz \
    && tar -xvf mariadb-connector-c-3.3.7-debian-buster-amd64.tar.gz \
    && cp mariadb-connector-c-3.3.7-debian-buster-amd64/lib/libmariadb.so.3 /usr/lib/ \
    && rm -rf mariadb-connector-c-3.3.7-debian-buster-amd64*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Production image
FROM node:20-slim

WORKDIR /app

# Copy MariaDB connector from builder
COPY --from=builder /usr/lib/libmariadb.so.3 /usr/lib/

# Copy node modules and source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["npm", "start"]
