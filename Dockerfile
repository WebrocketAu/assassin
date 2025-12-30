FROM node:20-alpine

# Install build dependencies for better-sqlite3 native module
RUN apk add --no-cache python3 make g++ libstdc++

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies - this compiles better-sqlite3 for the target architecture
RUN npm ci --only=production

# Copy application code
COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Remove build dependencies to reduce image size
RUN apk del python3 make g++

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["node", "server.js"]
