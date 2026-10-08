// Só no servidor do E2E (NODE_OPTIONS no playwright.config.ts). A rede desta máquina derruba
// conexões TCP ociosas em poucos segundos; sem keepalive, o pool do pg reaproveita uma conexão
// morta e a requisição falha (P1017 ConnectionClosed) ou fica pendurada até o ETIMEDOUT. Com
// keepalive, o pool percebe a queda, descarta a conexão e abre outra. O código do produto não muda
// (a configuração do pool em src/lib/db.ts ficou como pendência na evidência da Fase 6).
// CommonJS de propósito: carregado com --require antes do Next.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("node:net");

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connectWithKeepAlive(...args) {
  this.setKeepAlive(true, 1000);
  return connect.apply(this, args);
};
