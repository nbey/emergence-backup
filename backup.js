#!/usr/bin/env node

var fs = require('fs'),
    zlib = require('zlib'),
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
    filename: logsPath + '/backup'
});


// load config
winston.info('Loading config...');
var config = JSON.parse(fs.readFileSync(configPath));
winston.info('Loaded config:', config);


// connect to SSH
winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync(privateKeyPath)
});



winston.info('Executing backup...');

async.auto({
    getToday: function(callback) {
        callback(null, (new Date()).toISOString().split('T')[0]);
    },

    getHome: function(callback) {
        winston.info('Checking home directory...');
        ssh('echo $HOME', function(error, output, info) {
            if (error) return callback(error);

            var home = output.trim();

            if (!home) {
                winston.error('Failed to get home directory', info);
                return callback('Failed to get home directory');
            }

            winston.info('Remote home directory:', home);

            callback(null, home);
        });
    },

    makeDirectories: [
        'getHome',
        function(callback, results) {
            winston.info('Creating remote directories...');
            ssh('mkdir -p ~/emergence-sites/logs ~/emergence-sql/logs', function(error, output, info) {
                if (error) return callback(error);

                if (info.code != 0) {
                    return callback('Failed to create directories');
                }

                callback(null, true);
            });
        }
    ],

    getLastSnapshot: [
        'makeDirectories',
        function(callback, results) {
            winston.info('Finding latest snapshot...');
            ssh('ls -1r ~/emergence-sites', function(error, output, info) {
                if (error) return callback(error);

                output = output.trim();

                if (!output) {
                    winston.error('Failed to list existing snapshots:', info);
                    return callback('Snapshot listing failed');
                }

                var directoryRe = /^\d{4}-\d{2}-\d{2}$/,
                    directories = output.split('\n').filter(function(directory) {
                        return directoryRe.test(directory);
                    }),
                    latestSnapshot;

                directories.sort();
                winston.info('Found %s existing snapshots', directories.length);

                if (directories.length) {
                    latestSnapshot = directories[directories.length-1];
                    callback(null, latestSnapshot);
                } else {
                    callback(null, null);
                }
            });
        }
    ],

    initializeSnapshot: [
        'getToday',
        'getLastSnapshot',
        function(callback, results) {
            var lastSnapshot = results.getLastSnapshot,
                lastSnapshotPath = lastSnapshot && '~/emergence-sites/' + lastSnapshot,
                today = results.getToday,
                snapshotPath = '~/emergence-sites/' + today;

            if (!lastSnapshot) {
                winston.info('Starting new snapshot at %s...', snapshotPath);
                ssh(['mkdir', snapshotPath].join(' '), function(error, output, info) {
                    callback(error, snapshotPath);
                });
            } else if (lastSnapshot != today) {
                winston.info('Starting snapshot %s from %s...', snapshotPath, lastSnapshotPath);
                ssh(['cp -al', lastSnapshotPath, snapshotPath].join(' '), function(error, output, info) {
                    callback(error, snapshotPath);
                });
            } else {
                winston.info('Updating existing snapshot %s...', snapshotPath);
                callback(null, snapshotPath);
            }
        }
    ],

    uploadSnapshot: [
        'getToday',
        'initializeSnapshot',
        function(callback, results) {
            var today = results.getToday,
                remoteLogPath = 'emergence-sites/logs/' + today + '.gz',
                snapshotPath = results.initializeSnapshot;
            
            winston.info('Rsyncing snapshot to %s...', snapshotPath);

            rsync({
                host: config.user + '@' + config.host,
                privateKey: privateKeyPath,
                //noExec: true,

                src: '/emergence/sites/',
                dest: snapshotPath,

                //dryRun: true,
                recursive: true,
                deleteAll: true,
                exclude: [
                    '*.log', // log files
                    'site-data/media/*x*' // cached media thumbnails
                ],

                args: [
                    '-a',
                    '-i',
                    '--chmod=-rwx,ug+Xr,u+w',
                    '--links'
                ]
            }, function(error, stdout, stderr, cmd) {
                if (error) return callback(error);

                stdout = (stdout || '').trim();
                winston.info('Snapshot rsync finished, items changed:', stdout ? stdout.split(/\n/).length : 0);
                winston.verbose('rsync output:\n' + stdout);

                // TODO: don't overwrite existing log if it's an update
                var remoteLog = ssh.put(remoteLogPath),
                    gzip = zlib.createGzip();

                winston.info('Writing rsync log to %s...', remoteLogPath);

                gzip.pipe(remoteLog).on('close', function() {
                    winston.info('Saved remote log to %s', remoteLogPath);
                    callback(null, true);
                });

                gzip.end(stdout);
            });
        }
    ],

    uploadSql: [
        'getToday',
        'makeDirectories',
        function(callback, results) {
            var today = results.getToday,
                remoteLogPath = 'emergence-sql/logs/' + today + '.gz';

            winston.info('Rsyncing SQL backups to server...');

            rsync({
                host: config.user + '@' + config.host,
                privateKey: privateKeyPath,
                //noExec: true,

                src: '/emergence/sql-backups/',
                dest: '~/emergence-sql',

                //dryRun: true,
                recursive: true,

                args: [
                    '-a',
                    '-i',
                    '--chmod=-rwx,ug+Xr,u+w'
                ]
            }, function(error, stdout, stderr, cmd) {
                if (error) return callback(error);

                stdout = (stdout || '').trim();
                winston.info('SQL rsync finished, items changed:', stdout ? stdout.split(/\n/).length : 0);
                winston.verbose('rsync output:\n' + stdout);

                // TODO: don't overwrite existing log if it's an update
                var remoteLog = ssh.put(remoteLogPath),
                    gzip = zlib.createGzip();

                winston.info('Writing rsync log to %s...', remoteLogPath);

                gzip.pipe(remoteLog).on('close', function() {
                    winston.info('Saved remote log to %s', remoteLogPath);
                    callback(null, true);
                });

                gzip.end(stdout);
            });
        }
    ]

}, function(error, results) {
    if (error) {
        winston.error('Backup failed', error);
    }

    winston.info('Backup complete:', results);
    ssh.end();
});