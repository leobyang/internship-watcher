import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const apiDir = path.join(rootDir, 'src', 'app', 'api');
const tempApiDir = path.join(rootDir, 'src', 'app', '_api');

let renamed = false;
try {
  if (fs.existsSync(apiDir)) {
    fs.renameSync(apiDir, tempApiDir);
    renamed = true;
  }

  console.log('⚡ Building static Next.js export for GitHub Pages...');
  execSync('npx next build', {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: 'true',
    },
  });
  console.log('✅ Static export completed in web/out');
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exitCode = 1;
} finally {
  if (renamed && fs.existsSync(tempApiDir)) {
    fs.renameSync(tempApiDir, apiDir);
  }
}
