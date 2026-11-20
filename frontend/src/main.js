import { createApp } from 'vue';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import '@fortawesome/fontawesome-free/css/all.min.css';
import Toast from 'vue-toastification';
import 'vue-toastification/dist/index.css';
import './main.css';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';

createApp(App).use(router).use(i18n).use(Toast, { position: 'bottom-right', timeout: 3500 }).mount('#app');
