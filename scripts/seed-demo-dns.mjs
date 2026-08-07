import dns from 'node:dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);
await import('./seed-demo.mjs');