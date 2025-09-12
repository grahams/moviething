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

EXPOSE 3000
ENV SERVER_PORT=3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD sh -c 'curl -f http://localhost:${SERVER_PORT}/api/health || exit 1'

# Create a startup script
RUN echo '#!/bin/bash\n\
set -e\n\
echo "Waiting for dependencies..."\n\
sleep 5\n\
echo "Starting MovieThing application..."\n\
exec npm start' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"] 
