FROM node:26-trixie-slim

# No extra apt packages: the mariadb driver is pure JS (no libmariadb needed)
# and the healthcheck uses Node's built-in fetch instead of curl.

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/ ./server/
COPY client/ ./client/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
#COPY . .

ENV NODE_ENV=production

EXPOSE 3000
ENV SERVER_PORT=3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:'+process.env.SERVER_PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Create a startup script
RUN echo '#!/bin/bash\n\
set -e\n\
echo "Waiting for dependencies..."\n\
sleep 5\n\
echo "Starting MovieThing application..."\n\
exec npm start' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"] 
