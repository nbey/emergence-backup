# emergence-backup Installation

### On target machine:

    sudo mkdir /emergence/services/backup
    sudo ssh-keygen -f /emergence/services/backup/id_rsa -t rsa -N ''

    sudo npm install -g git+https://github.com/JarvusInnovations/emergence-backup.git
    sudo vim /emergence/services/backup/config.json

### config.json

    {
        "host": "example.com",
        "user": "siteuser"
    }


### On backup machine
    
    sudo /root/create-backup-host.sh siteuser
    sudo vim /mnt/emergence-backup/siteuser/.ssh/authorized_keys

Paste contents of id_rsa.pub output from last command on target machine

### Back on target machine:

Verify ssh can connect with the key

    sudo ssh -i /emergence/services/backup/id_rsa clients01@backup01.jarv.us

## Run Backup
    
    sudo emergence-backup
