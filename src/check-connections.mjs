import { createApplication } from './application.mjs';
import { createServices } from './services.mjs';
const services = createServices(process.env);
try {
  const app = createApplication({ services });
  const result = await app.checkConnections();
  for (const service of result.services) {
    console.log(`${service.name}: ${service.state} — ${service.message}`);
    if (service.missing.length) console.log(`  不足項目: ${service.missing.join(', ')}`);
  }
  process.exitCode = result.readiness.ready ? 0 : 1;
} finally { await services.close(); }
