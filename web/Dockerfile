FROM node:20-alpine

# Install openssl for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency markers first for caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Generate Prisma Client (build phase)
RUN npx prisma generate

# Build Next.js application
RUN npm run build

# Make the entrypoint script executable
RUN chmod +x scripts/entrypoint.sh

# The entrypoint will handle runtime migrations before executing the CMD
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
