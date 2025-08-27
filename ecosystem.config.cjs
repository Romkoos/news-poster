module.exports = {
    apps: [{
        name: 'news-poster',
        script: 'node',
        args: './node_modules/tsx/dist/cli.mjs src/index.ts',
        cwd: __dirname,

        cron_restart: '*/3 * * * *', // каждые 3 минуты
        autorestart: false,
        instances: 1,

        time: true,
        error_file: 'logs/err.log',
        out_file: 'logs/out.log',
        merge_logs: true,
        env: { NODE_ENV: 'production' },
    }],
};
