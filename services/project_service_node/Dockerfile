FROM node:18-alpine

WORKDIR /workspace/services/project_service_node

COPY project_service_node/package.json project_service_node/package-lock.json ./
RUN npm ci --omit=dev

COPY project_service_node ./
COPY common ../common

RUN mkdir -p /workspace/logs /workspace/storage/projects /workspace/storage/uploads

EXPOSE 5004

CMD ["node", "server.js"]
