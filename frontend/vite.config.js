import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

// Comme JRAPay : le .env.development / .env.production est lu à la racine du projet.
export default defineConfig(({ mode }) => {
	const envDir = path.resolve(__dirname, '..');
	const env = loadEnv(mode, envDir, '');

	return {
		plugins: [vue()],
		root: path.resolve(__dirname, '.'),
		envDir,
		resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
		build: { outDir: 'dist' },
		server: {
			port: Number(env.FRONTEND_PORT) || 5173,
			host: true,
			// Hôtes acceptés (ex. integrisea.local via Apache/Laragon). PUBLIC_HOST pour en ajouter.
			allowedHosts: ['localhost', '.local', ...(env.PUBLIC_HOST ? env.PUBLIC_HOST.split(',') : [])],
			// L'API est appelée en relatif (/api) : même origine, donc pas de CORS.
			proxy: { '/api': { target: `http://127.0.0.1:${env.BACKEND_PORT || 4000}`, changeOrigin: false } },
		},
		define: {
			// Vide = même origine (/api). À renseigner seulement si l'API est sur un autre domaine.
			__API_BASE__: JSON.stringify(env.API_BASE_URL || ''),
		},
	};
});
