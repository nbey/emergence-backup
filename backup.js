#!/usr/bin/env node

var fs = require('fs'),
    zlib = require('zlib'),
    async = require('async'),
    winston = require('winston'),
    sequest = require('sequest'),
    rsync = require('rsyncwrapper').rsync,
    cp = require('child_process'),
    execSync = require('exec-sync');

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


connect to SSH
//winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync(privateKeyPath)
});

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
					'--links',
					'--compress'
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
	],
    
    checkBackupDirectory: function(callback) {
    	if (!fs.existsSync('/emergence/sql-backups')) {
    		winston.info('Creating /emergence/sql-backups directory.');
    		
    		fs.mkdirSync('/emergence/sql-backups');
    	}
    	
    	callback(null, true);
    },
    
    getSqlDatabases:function(callback, results) {
		var dateStamp = results.getToday,
			dayNum = dateStamp.split('-').pop(),
			
			dbUsername = config.database.username,
			dbPassword = config.database.password,
			dbSocket = config.database.socket,
			ignoreDbs = config.database.ignore || ['mysql', 'information_schema', 'performance_schema'],
			
			mysqlCmd = [
				"mysql",
				"-u",
				dbUsername,
				"-S",
				dbSocket,
				"-p"+dbPassword,
				"-Bse",
				"'show databases'"
			],
			databases = [],
			database;
		
		winston.info("Retrieving Databases...");
		
		cp.exec(mysqlCmd.join(' '), function(err, stdout, stderr) {
			if (err) {
				winston.info('There was an error retrieving a list of databases');
				callback(err);
			} else {
				databases = stdout.split(/\n/);
				databases = databases.filter(function(n){ return n && n.length && n != undefined });
				winston.info('Found Databases: %s', databases.join(', '));
				callback(null, databases.join(','));
			}
		});	
    },
        
    backupSqlDatabases: [
    	'getToday',
    	'checkBackupDirectory',
    	'getSqlDatabases',
    	function(callback, results) {
    		var dateStamp = results.getToday,
    			dayNum = dateStamp.split('-').pop(),
    			
    			dbUsername = config.database.username,
				dbPassword = config.database.password,
				dbSocket = config.database.socket,
				ignoreDbs = config.database.ignore || ['mysql', 'information_schema', 'performance_schema'],
				
    			databases = results.getSqlDatabases.split(',');    			
    			
    		winston.info("Backing up Sql Databases:", databases);
    		
			while (database = databases.shift()) {
				var filename = (database+"."+dateStamp+".sql.bz2"),
					backupDir = '/emergence/sql-backups/'+database,
					fullFilename = backupDir + '/' + filename,
					backupCmdArgs = [
						'mysqldump',
						'--opt',
						'--force',
						'--single-transaction',
						'--quick',
						'-S',
						dbSocket,
						'-u',
						dbUsername,
						'-p'+dbPassword,
						database,
						'--ignore-table='+database+".sessions",
						'| bzip2 > ',
						fullFilename
					],
					
					backupProcess;
			
				if (database.match(/^\_/) || ignoreDbs.indexOf(database) !== -1) {
					winston.info("Skipping DB: %s", database);
					continue;
				}
			
				if (!fs.existsSync(backupDir)) {
					fs.mkdirSync(backupDir);
				}
			
				
				var backupFn = function(callCallback) {
					var mysqlbackup;
					
					winston.info('Running cmd: %s', backupCmdArgs);
					
					mysqlbackup = cp.spawn('sh', ['-c', backupCmdArgs.join(' ')], {stdio: 'inherit'});

					mysqlbackup.on('close', function (code) {
						if (code !== 0) {
							console.log('mysqldump process exited with code ' + code);
						}
						
						if (callCallback === true) {
							callback(null, 'Complete');
						}
					  
					});

				};
				
				if (dayNum != '01') {
					var removeResponse;
					
					winston.info("Erasing %s.*-%s.sql.bz2", database, dayNum);
					removeResponse = execSync('rm '+backupDir+'/'+database+".*-"+dayNum+".sql.bz2", true);
					
					if (removeResponse.stderr) {
						winston.info('There was an error removing old backup file(s): %s', removeResponse.stderr);
					}	
				}
				
				backupFn(databases.length===1);
			}		
    	} 
	],

}, function(error, results) {
    if (error) {
        winston.error('Backup failed:', error);
    }

    winston.info('Backup complete:', results);
//     ssh.end();
});