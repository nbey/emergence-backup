# emergence-backup Installation

### On target machine:
```
sudo mkdir /emergence/services/backup
sudo ssh-keygen -f /emergence/services/backup/id_rsa -t rsa -N ''

sudo npm install -g git+https://github.com/JarvusInnovations/emergence-backup.git
sudo vim /emergence/services/backup/config.json
```
### config.json

```
{
    "host": "example.com",
    "user": "siteuser",
    "database": {
        "username": "backup",
        "password": "backup_password",
        "socket" : "/emergence/services/run/mysqld/mysqld.sock",
        "ignore" : [
            "mysql", "information_schema", "performance_schema"
        ]
    }
}
```

### On backup machine

```
sudo /root/create-backup-host.sh siteuser
sudo vim /mnt/emergence-backup/siteuser/.ssh/authorized_keys
```

Paste contents of id_rsa.pub output from last command on target machine

### Back on target machine:

Verify ssh can connect with the key

```
sudo ssh -i /emergence/services/backup/id_rsa username@example.com
```

# sql-backup Installation 

### Create mysql database user

```
mysql>CREATE USER 'backup'@'localhost' IDENTIFIED BY 'CREATEPASSWORD';
mysql>GRANT SELECT, LOCK TABLES, SHOW VIEW ON *.* TO 'backup'@'localhost';
```

Now place password you used to create the backup mysql user to the config file (/emergence/services/backup/config.json)

## Update Nightly Cronjob

*This step is only necessary if you aren't using the nightly-backup cronjob as it runs the followng two in succession.

Update cron.d to run both the nightly backup and the emergence-backup daily. Stagger the first two numbers (ie. 5:05 AM) relative to the backup site so all the backups aren't running at the same time. 

````
5 5     * * *   root    /usr/local/bin/emergence-backup
````

## Manually Run Backup

```
sudo emergence-backup
```
