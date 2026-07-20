# Secrets

These files are optional. Place them in this directory when you want to supply
your own manager TLS material or master key:

- `manager.crt`: PEM certificate chain for `MANAGER_HOST`.
- `manager.key`: matching PEM private key.
- `nginx_manager_master_key`: stable 32-byte random master key.

If any of them are omitted, the container generates replacements under the
persistent `/data/secrets` volume:

- a self-signed certificate for `MANAGER_HOST`
- a 32-byte master key that stays stable across restarts of the same volume

Provide real secrets for production deployments. Generated material is fine for
local smoke tests only. Never commit secret files.

Generate a master key once when you want to pin it yourself:

```sh
openssl rand -out nginx_manager_master_key 32
```

Do not regenerate a production master key when rebuilding or restarting the
container.

The process runs as UID/GID `10001`. On native Linux, make host-provided files
readable only by that identity:

```sh
sudo chown 10001:10001 manager.crt manager.key nginx_manager_master_key
sudo chmod 0400 manager.crt manager.key nginx_manager_master_key
```
