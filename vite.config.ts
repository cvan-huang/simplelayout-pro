import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/simplelayout-pro/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '127.0.0.1'
  },
});

