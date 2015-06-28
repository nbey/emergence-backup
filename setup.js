var winston = require('winston'),
    prompt = require('prompt'),
    sequest = require('sequest');

prompt.start();

prompt.get([{
    name: 'host',
    required: true
}, {
    name: 'username',
    required: true
}, {
    name: 'password',
    hidden: true
}], function (err, result) {

    winston.info('Creating SSH connection...');
    var ssh = sequest.connect(result);

    winston.info('Checking home directory...');
    ssh('echo $HOME', function(error, output, info) {
        winston.info('error:', error);
        winston.info('output:', output);
        winston.info('info:', info);
    });
});

/*
var fs = require('fs'),
    async = require('async'),
    rsync = require('rsyncwrapper').rsync;


// configure logger
if (!fs.existsSync('/var/log/emergence-backup')){
    fs.mkdirSync('/var/log/emergence-backup');
}

winston.add(winston.transports.DailyRotateFile, {
    level: 'verbose',
    filename: '/var/log/emergence-backup/log'
});


// load config
winston.info('Loading config...');
var config = JSON.parse(fs.readFileSync('/etc/mrbackup/config.json'));
winston.info('Loaded config:', config);


winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync('/etc/mrbackup/id_rsa')
});


winston.info('Executing backup...');

async.auto({
    getHome: function(callback) {
        winston.info('Checking home directory...');
        ssh('echo $HOME', function(error, output, info) {
            var home = output.trim(0);
            winston.info('Remote home directory:', home);
            callback(null, home);
        });
    },
*/
