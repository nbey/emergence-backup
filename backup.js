var fs = require('fs'),
    async = require('async'),
    winston = require('winston'),
    sequest = require('sequest'),
    rsync = require('rsyncwrapper').rsync;


// paths
var backupServicePath = '/emergence/services/backup',
    configPath = backupServicePath + '/config.json',
    privateKeyPath = backupServicePath + '/id_rsa',
    logsPath = backupServicePath + '/logs';


// configure logger
if (!fs.existsSync(logsPath)){
    fs.mkdirSync(logsPath);
}

winston.add(winston.transports.DailyRotateFile, {
    level: 'verbose',
    filename: logsPath + '/backup'
});


// load config
winston.info('Loading config...');
var config = JSON.parse(fs.readFileSync(configPath));
winston.info('Loaded config:', config);


winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync(privateKeyPath)
});


winston.info('Executing backup...');

async.auto({
    getHome: function(callback) {
        winston.info('Checking home directory...');
        ssh('echo $HOME', function(error, output, info) {
            if (error) {
                callback(error);
                return;
            }

            var home = output.trim();
            winston.info('Remote home directory:', home);
            callback(null, home);
        });
    },

    makeDirectories: [
        'getHome',
        function(callback, results) {
            winston.info('Creating remote directories...');
            ssh('mkdir -p ~/emergence-sites/logs ~/emergence-sql/logs', function(error, output, info) {
                if (error) {
                    callback(error);
                    return;
                }

                if (info.code == 0) {
                    callback();
                } else {
                    callback('Failed to create directories');
                }
            });
        }
    ],

    syncSql: [
        'makeDirectories',
        function(callback, results) {
            winston.info('Synchronizing SQL backups to server...');
            rsync({
                host: config.user + '@' + config.host,
                privateKey: privateKeyPath,
                //noExec: true,

                src: '/emergence/sql-backups/',
                dest: '~/emergence-sql',

                recursive: true,
                //dryRun: true,

                args: [
                    '-a',
                    '-i',
                    '--chmod=-rwx,ug+Xr,u+w'
                ]
            }, function(error, stdout, stderr, cmd) {
                winston.info('Finished rsync:', cmd);

                if (error) {
                    callback(error);
                } else {
                    stdout = (stdout || '').trim();
                    winston.info('sql synchronized, items changed:', stdout ? stdout.split(/\n/).length : 0);
                    winston.verbose('rsync output:\n' + stdout);
                    callback();
                }
            });
        }
    ]

}, function(error, results) {
    if (error) {
        winston.error('Backup failed', error);
    }

    winston.info('Backup results', results);
    ssh.end();
});