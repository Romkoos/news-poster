module.exports = {
    apps: [{
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
        // опционально красиво пометить строки логов
        log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }],
};
