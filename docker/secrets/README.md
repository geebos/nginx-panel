# Production secrets

Place these deployment-owned files in this directory before starting the
production Compose stack:

- `manager.crt`: PEM certificate chain for `MANAGER_HOST`.
- `manager.key`: matching PEM private key.
- `nginx_manager_master_key`: stable 32-byte random master key.

The files are ignored by Git and must be backed up outside this repository.

Generate the master key once:

```sh
openssl rand -out nginx_manager_master_key 32
```

Do not regenerate it when rebuilding or restarting the container.

The production process runs as UID/GID `10001`. File-backed Docker Compose
secrets preserve host ownership on native Linux, so make the three files
readable only by that identity before deployment:

```sh
sudo chown 10001:10001 manager.crt manager.key nginx_manager_master_key
sudo chmod 0400 manager.crt manager.key nginx_manager_master_key
```
