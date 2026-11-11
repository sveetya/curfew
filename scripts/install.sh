#!/usr/bin/env bash
set -euo pipefail
cd /opt/data/curfew
npm install --no-audit --no-fund -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @types/node
npm install --no-audit --no-fund react react-dom @tauri-apps/api @tauri-apps/plugin-updater @tauri-apps/plugin-process @tauri-apps/plugin-autostart
npm install --no-audit --no-fund -D @tauri-apps/cli
echo "INSTALL_OK"
