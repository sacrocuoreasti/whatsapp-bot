const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'patches', 'baileys');
const destDir = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[Patch] Applicato: ${path.relative(destDir, destPath)}`);
    }
  }
}

if (fs.existsSync(destDir)) {
  console.log('[Patch] Applicazione patch WhatsApp Newsletter per Baileys...');
  copyRecursive(srcDir, destDir);
  console.log('[Patch] Tutte le patch per i Canali WhatsApp sono state applicate con successo.');
} else {
  console.log('[Patch] node_modules/@whiskeysockets/baileys non trovato, patch saltata.');
}
