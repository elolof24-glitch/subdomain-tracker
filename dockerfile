FROM golang:1.24-bookworm AS tools

RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest

FROM node:22-bookworm-slim

COPY --from=tools /go/bin/subfinder /usr/local/bin/subfinder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
