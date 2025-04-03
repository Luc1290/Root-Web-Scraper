# Image officielle Node.js
FROM mcr.microsoft.com/playwright:v1.51.1-jammy

WORKDIR /app
COPY . .

RUN npm install

EXPOSE 5123
CMD ["npm", "start"]
