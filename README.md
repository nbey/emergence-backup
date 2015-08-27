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
    "user": "siteuser"
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

The next step is to install the sql-backup script to faciliate the sql nightly sql backups.

```
sudo mkdir /emergence/sql-backups
sudo wget https://gist.github.com/themightychris/0c08d47d7025f8867512/raw/68adfec5a373f539155283835df5afca90f61ea2/emergence-sql-backup -O /etc/cron.d/emergence-sql-backup
cd /usr/local/bin/
sudo wget https://gist.github.com/themightychris/0c08d47d7025f8867512/raw/bfd10e39eeb2cd7630e99b622e3727cb66fb416f/backup-all-databases.pl
sudo chmod 700 backup-all-databases.pl
sudo chown root:root backup-all-databases.pl
```

### Create mysql database user

```
mysql>CREATE USER 'backup'@'localhost' IDENTIFIED BY 'CREATEPASSWORD';
mysql>GRANT SELECT, LOCK TABLES, SHOW VIEW ON *.* TO 'backup'@'localhost';
```

Now place password you used to create he backup mysql user to the 

```
sudo vim /usr/local/bin/backup-all-databases.pl
```

## Update Nightly Cronjob

todo

## Manually Run Backup

```
sudo emergence-backup
```
