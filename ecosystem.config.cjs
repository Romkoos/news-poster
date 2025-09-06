// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'news-poster',
            script: 'node',
            args: './node_modules/tsx/dist/cli.mjs src/index.ts',
            cwd: __dirname,

            cron_restart: '*/3 * * * *',  // каждые 3 минуты
            autorestart: false,
            instances: 1,

            time: true,
            merge_logs: true,

            env: { NODE_ENV: 'production' },
            log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'
        },
        {
            name: 'news-poster-purge',
            script: 'node',
            args: './node_modules/tsx/dist/cli.mjs src/purge.ts',
            cwd: __dirname,

            cron_restart: '0 0 * * *',  // каждый день в 00:00
            autorestart: false,
            instances: 1,

            time: true,
            merge_logs: true,

            env: { NODE_ENV: 'production', TZ: 'Asia/Jerusalem' }, // Израильское время
            log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'
        },
        {
            name: 'news-api',
            script: 'node',
            args: './node_modules/tsx/dist/cli.mjs src/api.ts',
            cwd: __dirname,
            autorestart: true,
            instances: 1,
            time: true,
            merge_logs: true,
            env: {
                NODE_ENV: 'production',
                API_PORT: 8080,
                // CORS_ORIGIN: 'http://localhost:5173,https://your-frontend-domain'
            },
            log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
        }
    ],
};
