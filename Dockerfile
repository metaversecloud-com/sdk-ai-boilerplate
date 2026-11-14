ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine
WORKDIR /app
ARG COMMIT_HASH
ENV COMMIT_HASH=$COMMIT_HASH
ARG BUILD_TIME
ENV BUILD_TIME=$BUILD_TIME
ADD server ./server
ADD client ./client
ADD package* ./
ADD node_modules ./node_modules
EXPOSE 3000
ENTRYPOINT [ "npm", "start" ]
