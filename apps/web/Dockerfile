FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Expose port exactly as defined in docker-compose.yml
EXPOSE 3000

# Start development server configured to use the correct port and listen on all interfaces
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
